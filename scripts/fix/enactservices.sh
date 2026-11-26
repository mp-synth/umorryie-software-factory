#!/usr/bin/env bash
# EnactServices' fix command: the autofixers on the branch's own changes. It never commits: the server
# commits what changed, then runs the checks. Exit 0 on success, nonzero when generation fails,
# 75 for trouble outside the branch (package index, network), 126 when it cannot run.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../checks/enactservices.sh"

prepare
if ! env_in_sync; then
  echo "== Syncing the environment with uv.lock"
  run_classified "$TOOL_TROUBLE" uv sync --frozen
  code=$?
  case "$code" in
    0) ;;
    126|127) exit "$code" ;;
    *) echo "uv sync --frozen failed because of this branch's project or lock data."; exit 1 ;;
  esac
fi

echo "== prek's fixing hooks on the branch's changes (ruff --fix, ruff-format, detect-missing-init, tach sync, OpenAPI)"
run_classified "$TOOL_TROUBLE" "${UV[@]}" prek run --from-ref "$base" --to-ref HEAD
echo "(prek exit $?; what it could not fix is for the checks to report)"

if source_changes_match "$SPEC_INPUTS"; then
  echo "== OpenAPI: regenerating idl/"
  generate_openapi || exit $?
fi

echo "== Changed by the fixers"
git status --short
exit 0
