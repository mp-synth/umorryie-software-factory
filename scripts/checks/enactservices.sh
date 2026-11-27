#!/usr/bin/env bash
# EnactServices' checks command: what its CI runs on a PR, locally, in the ticket's worktree.
#   1. lint: prek on the branch's changes
#   2. OpenAPI: the specs under idl/ match the code
#   3. CI's two cheap pytest calls (deployment-units drift, worker stop timeout)
#   4. the tier-1 tests (enactservices-select-tests.py). A failure counts only when it is the branch's:
#      it fails again on a rerun (not a flake) and passes on the base (not this machine's).
# Exit 0 pass, 1 the branch's failure, 75 trouble outside the branch (retry later), 126 cannot run.
# The merge check and the fix command source this file for its functions.
set -uo pipefail

checks_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export PREK_NATIVE_TLS=1 UV_NO_SYNC=1
UV=(uv run --frozen --no-sync)
TOOL_TROUBLE='401 Unauthorized|403 Forbidden|status code:? 40[13]|error sending request|[Ff]ailed to (fetch|download|clone)|Could not connect|dns error|Connection reset by peer|operation timed out'
SERVICE_TROUBLE='MongoDB is not reachable|Redis is not reachable'
HOOK_OPENAPI_PATHS='^service/.*handlers/.*\.py$|^service/.*api_models/.*\.py$|^idl/'
SPEC_INPUTS='^(service|packages)/.*\.py$|^idl/'
TEST_FILES='/tests/|(^|/)test_[^/]*\.py$|(^|/)conftest\.py$'

restore_idl() {
  git checkout -q -- idl/
  git clean -fdq -- idl/
  restore_idl_on_exit=""
}

trouble() {
  [ -z "${restore_idl_on_exit:-}" ] || restore_idl
  echo "INFRASTRUCTURE: $*"
  exit 75
}

# Sets $base, $scratch, $test_db, $redis_db and $TEST_ENV.
prepare() {
  [ -n "${FACTORY_BASE:-}" ] || { echo "FACTORY_BASE is not set."; exit 126; }
  base=$(git merge-base "$FACTORY_BASE" HEAD) || { echo "No merge base between $FACTORY_BASE and HEAD."; exit 126; }
  scratch=$(mktemp -d)
  trap cleanup EXIT
  local id
  id=$(git rev-parse --show-toplevel | shasum | cut -c1-12)
  test_db=fac_$id
  redis_db=${FACTORY_SLOT:-$((16#${id:0:6} % 15 + 1))}
  TEST_ENV=(
    ENV=test
    API_MONGODB_HOST=localhost
    REDIS_HOST=localhost
    AWS_DEFAULT_REGION=eu-west-1
    PYTHONDONTWRITEBYTECODE=1
    "API_MONGODB_DATABASE=$test_db"
    "REDIS_DB=$redis_db"
  )
}

# run_classified [-q] PATTERN COMMAND...: output to stdout (not with -q) and to $step_log.
# A failure whose output matches PATTERN is not the branch's: it exits 75.
run_classified() {
  local quiet="" pattern code log=${step_log:-$scratch/step.log}
  [ "$1" = -q ] && { quiet=1; shift; }
  pattern=$1
  shift
  if [ -n "$quiet" ]; then "$@" >"$log" 2>&1; else "$@" 2>&1 | tee "$log"; fi
  code=${PIPESTATUS[0]}
  if [ "$code" -ne 0 ] && grep -qE "$pattern" "$log"; then
    trouble "$(grep -m1 -E "$pattern" "$log")"
  fi
  return "$code"
}

kill_tree() {
  local child
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill "$1" 2>/dev/null
}

# A generator still running in the background ($generator) leaves idl/ half written: stop it and restore idl/.
cleanup() {
  if [ -n "${generator:-}" ] && kill -0 "$generator" 2>/dev/null; then
    kill_tree "$generator"
    wait "$generator" 2>/dev/null
    restore_idl_on_exit=1
  fi
  [ -z "${restore_idl_on_exit:-}" ] || restore_idl
  git worktree remove --force "$scratch/base" >/dev/null 2>&1
  rm -rf "$scratch"
}

env_in_sync() { uv sync --frozen --check >"$scratch/sync.log" 2>&1; }

require_synced_env() {
  [ -x .venv/bin/python ] || { echo "No .venv here: the project's setup command (uv sync --frozen) has not run."; exit 126; }
  env_in_sync && return 0
  local code=$?
  case "$code" in 126|127) exit "$code" ;; esac
  # A merge of the base branch can bring a new uv.lock; the project's setup command brings the environment along.
  { uv sync --frozen || uv sync --frozen --offline; } >"$scratch/sync.log" 2>&1 && env_in_sync && return 0
  echo "The environment does not match this branch's uv.lock or project metadata, even after uv sync --frozen:"
  tail -n 20 "$scratch/sync.log"
  exit 1
}

port_open() { (exec 3<>"/dev/tcp/localhost/$1") 2>/dev/null; }

require_services() {
  port_open "${API_MONGODB_PORT:-27017}" || trouble "MongoDB does not answer on localhost:${API_MONGODB_PORT:-27017}."
  port_open "${REDIS_PORT:-6379}" || trouble "Redis does not answer on localhost:${REDIS_PORT:-6379}."
}

pytest_here() { env "${TEST_ENV[@]}" "${UV[@]}" pytest -p no:cacheprovider -q -rfE "$@"; }

changed() { git diff --name-only "$base" HEAD; }
changes_match() { changed | grep -qE "$1"; }
source_changes_match() { changed | grep -vE "$TEST_FILES" | grep -qE "$1"; }

lint() {
  echo "== Lint: prek on the branch's changes"
  run_classified "$TOOL_TROUBLE" "${UV[@]}" prek run --from-ref "$base" --to-ref HEAD
}

generate_openapi() {
  restore_idl_on_exit=1
  run_classified -q "$TOOL_TROUBLE" env ENV=local bash -c 'source scripts/local_mongodb_env.sh && exec "$@"' _ \
    "${UV[@]}" invoke generate-openapi
  local code=$?
  if [ "$code" -eq 0 ]; then
    restore_idl_on_exit=""
    return 0
  fi
  local log=${step_log:-$scratch/step.log}
  if grep -q '^✗ Failed' "$log"; then sed -n '/^✗ Failed/,$p' "$log"; else tail -n 40 "$log"; fi
  echo "Generating the OpenAPI specs failed."
  restore_idl
  return "$code"
}

# Regenerates idl/; when it differs from the commit, shows how, restores idl/ and fails.
openapi_matches() {
  generate_openapi || return 1
  if git diff --quiet -- idl/ && [ -z "$(git ls-files --others --exclude-standard idl/)" ]; then
    return 0
  fi
  git diff --stat -- idl/
  git ls-files --others --exclude-standard idl/ | sed 's/^/new: /'
  echo "The OpenAPI specs are stale: the fix command regenerates them (ENV=local uv run invoke generate-openapi)."
  restore_idl
  return 1
}

# Writes the tier-1 selection for the given bases to $scratch/selection.
select_tests() {
  .venv/bin/python "$checks_dir/enactservices-select-tests.py" "$@" >"$scratch/selection" 2>"$scratch/select.err"
  local code=$?
  sed 's/^/  /' "$scratch/select.err"
  [ "$code" -eq 0 ] || { echo "The test selector failed (exit $code)."; exit 126; }
}

# One xdist worker per service in the selection, up to 4: the repo's scheduler keeps a service on one worker.
workers() {
  local services
  services=$(sed -E 's#^service/([^/]+)/.*#\1#; s#^test/unit/.*#unit#; s#^([^/]+/[^/]+)/.*#\1#' "$1" | sort -u | wc -l)
  if [ "$services" -gt 1 ]; then echo $((services < 4 ? services : 4)); else echo 0; fi
}

failed_ids() { sed -nE '/^(FAILED|ERROR) / { s/^(FAILED|ERROR) //; s/ - .*//; p; }' "$1" | sort -u; }

run_pytest_targets() {
  local file=$1 target
  local targets=()
  shift
  while IFS= read -r target || [ -n "$target" ]; do
    [ -z "$target" ] || targets+=("$target")
  done <"$file"
  "$@" "${targets[@]}"
}

cheap_ci_tests() {
  local status=0 target
  for target in scripts/deployment_units/tests service/temporal/tests/test_worker_stop_timeout.py; do
    [ -e "$target" ] || continue
    echo "== CI's pytest $target --noconftest"
    run_classified "$SERVICE_TROUBLE" pytest_here "$target" --noconftest || status=1
  done
  return "$status"
}

# Fails only for tests that fail twice here and pass on the base.
tier1_tests() {
  echo "== Tests: the tier-1 selection"
  select_tests "$base"
  [ -s "$scratch/selection" ] || { echo "No tests to run for these changes."; return 0; }
  sed 's/^/  /' "$scratch/selection"
  require_services
  echo "  (Mongo database $test_db, Redis DB $redis_db, $(workers "$scratch/selection") xdist workers)"
  run_classified "$SERVICE_TROUBLE" run_pytest_targets "$scratch/selection" pytest_here -n "$(workers "$scratch/selection")"
  local code=$?
  if [ "$code" -eq 0 ] || [ "$code" -eq 5 ]; then return 0; fi
  failed_ids "$scratch/step.log" >"$scratch/failed"
  [ -s "$scratch/failed" ] || { echo "pytest exited $code without naming a failing test."; return 1; }

  echo "== Rerunning the $(wc -l <"$scratch/failed" | tr -d ' ') failing tests once, to tell flakes apart"
  run_classified -q "$SERVICE_TROUBLE" run_pytest_targets "$scratch/failed" pytest_here
  local rerun_code=$?
  cp "$scratch/step.log" "$scratch/rerun.log"
  if [ "$rerun_code" -ne 0 ] && [ "$rerun_code" -ne 1 ]; then
    echo "pytest rerun exited unexpectedly with $rerun_code; keeping the test failure."
    tail -n 40 "$scratch/rerun.log"
    return 1
  fi
  failed_ids "$scratch/rerun.log" >"$scratch/still"
  if [ "$rerun_code" -ne 0 ] && [ ! -s "$scratch/still" ]; then
    echo "pytest rerun failed without naming a failing test; keeping the test failure."
    tail -n 40 "$scratch/rerun.log"
    return 1
  fi
  comm -23 "$scratch/failed" "$scratch/still" | sed 's/^/flaky, passed on rerun: /'
  [ -s "$scratch/still" ] || return 0

  if changes_match '^packages/'; then
    echo "== Not comparing with the base: the branch changes packages/, which a base run would import from this worktree"
    cp "$scratch/still" "$scratch/mine"
  else
    echo "== Running the tests that still fail on the branch's base, to tell this machine's failures apart"
    local here=$PWD
    git worktree add -q --detach "$scratch/base" "$base" || trouble "could not check out the base ($base) to compare the failing tests with"
    (cd "$scratch/base" && run_classified -q "$SERVICE_TROUBLE" run_pytest_targets "$scratch/still" env "${TEST_ENV[@]}" \
      "$here/.venv/bin/python" -m pytest -p no:cacheprovider -q -rfE)
    local base_code=$?
    [ "$base_code" -eq 75 ] && exit 75
    if [ "$base_code" -ne 0 ] && [ "$base_code" -ne 1 ]; then
      echo "pytest on the base exited unexpectedly with $base_code; keeping the test failure."
      tail -n 40 "$scratch/step.log"
      return 1
    fi
    failed_ids "$scratch/step.log" >"$scratch/on-base"
    comm -12 "$scratch/still" "$scratch/on-base" | sed 's/^/fails on the base too, so not this branch: /'
    comm -23 "$scratch/still" "$scratch/on-base" >"$scratch/mine"
  fi
  [ -s "$scratch/mine" ] || return 0
  echo
  echo "These tests fail with this branch and pass on its base ($base):"
  cat "$scratch/mine"
  grep -E "^(FAILED|ERROR) " "$scratch/rerun.log" | grep -F -f "$scratch/mine"
  return 1
}

main() {
  prepare
  require_synced_env
  local failed=""
  lint || failed="$failed lint"
  if changes_match "$HOOK_OPENAPI_PATHS"; then
    echo "== OpenAPI: checked by prek's generate-openapi hook"
  elif source_changes_match "$SPEC_INPUTS"; then
    echo "== OpenAPI: the specs under idl/ match the code"
    openapi_matches || failed="$failed openapi"
  fi
  cheap_ci_tests || failed="$failed ci-tests"
  tier1_tests || failed="$failed tests"
  [ -z "$failed" ] && { echo "== All checks passed"; exit 0; }
  echo "== Failed:$failed"
  exit 1
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
