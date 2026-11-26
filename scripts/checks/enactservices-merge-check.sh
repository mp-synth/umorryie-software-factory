#!/usr/bin/env bash
# EnactServices' merge check: right after the server merged the branch below (or the base) into a ticket,
# before it pushes, catch the names and signatures the merge broke. `ty` does not see a missing name;
# generating the OpenAPI specs (it imports every HTTP handler) and collecting the tier-1 tests do.
# The two run side by side to stay well under 90 s. Same exit codes as enactservices.sh.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/enactservices.sh"

prepare
require_synced_env
failed=""
(step_log=$scratch/openapi.log openapi_matches) >"$scratch/openapi.out" 2>&1 &
generator=$!

echo "== Collecting the tier-1 tests"
if [ -n "${FACTORY_GREEN_BASE:-}" ] && git merge-base --is-ancestor "$FACTORY_GREEN_BASE" HEAD 2>/dev/null; then
  select_tests "$base" "$FACTORY_GREEN_BASE"
else
  select_tests "$base"
fi
if [ -s "$scratch/selection" ]; then
  require_services
  run_classified -q "$SERVICE_TROUBLE" run_pytest_targets "$scratch/selection" pytest_here --collect-only
  code=$?
  log=$scratch/step.log
  if [ "$code" -eq 0 ] || [ "$code" -eq 5 ]; then
    tail -n 1 "$log"
  elif grep -qE '^=+ ERRORS =+$' "$log"; then
    sed -n '/^=* ERRORS =*$/,$p' "$log" | grep -v ddtrace | head -n 60
    echo "-- distinct errors:"
    grep -E '^E  ' "$log" | sort | uniq -c | sort -rn | head -n 20
    echo "-- test files that do not collect:"
    grep -E '^ERROR ' "$log" | head -n 50
    tail -n 1 "$log"
    failed="$failed collection"
  else
    grep -m1 'while loading conftest' "$log"
    grep -v ddtrace "$log" | tail -n 40
    failed="$failed collection"
  fi
fi

echo "== OpenAPI: the specs generate and match idl/"
wait "$generator"
code=$?
generator=""
cat "$scratch/openapi.out"
[ "$code" -eq 75 ] && exit 75
[ "$code" -eq 0 ] || failed="$failed openapi"

[ -z "$failed" ] && { echo "== Merge check passed"; exit 0; }
echo "== Failed:$failed"
exit 1
