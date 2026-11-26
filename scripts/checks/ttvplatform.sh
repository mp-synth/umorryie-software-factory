#!/usr/bin/env bash
# TTVPlatform's checks command: what "Validate (merge queue & PR)" runs, for the packages the branch
# affects (turbo's "...[merge base]": the changed packages and their dependents).
#   1. prettier on the changed files, and the manifest lint
#   2. turbo: ci:lint, ci:typecheck, ci:unused (knip), ci:i18n
#   3. contract:validate-types when @synthesia/api-contracts is affected
#   4. the Jest tests related to the changed files (pnpm test:affected, the repo's own selection)
# A script or task the repo does not define is skipped. Exit 0 pass, 1 the branch's failure, 126 cannot run.
# Generated types ahead of the published backend spec print a WAITING-ON-BACKEND: line; when that is the only
# failure the exit is 3, which the factory treats as a pass that waits on the backend.
set -uo pipefail

[ -n "${FACTORY_BASE:-}" ] || { echo "FACTORY_BASE is not set."; exit 126; }
base=$(git merge-base "$FACTORY_BASE" HEAD) || { echo "No merge base between $FACTORY_BASE and HEAD."; exit 126; }
[ -d node_modules ] || { echo "No node_modules here: the project's setup command (pnpm install) has not run."; exit 126; }
[ -r turbo.json ] && node -e 'const tasks = require("./turbo.json").tasks; process.exit(tasks && typeof tasks === "object" ? 0 : 1)' 2>/dev/null \
  || { echo "turbo.json is not readable or does not define tasks."; exit 126; }
export TURBO_CACHE_DIR="${FACTORY_HOME:-$HOME/.software-factory}/cache/turbo-ttvplatform"
TURBO_FLAGS="--continue=always --concurrency=50% --filter=...[$base]"
CONTRACT_TYPES=packages/api-contracts/generated
scratch=$(mktemp -d)
clean_tree=""

# Generators below rewrite tracked files to compare them; put a tree that was clean back as it was.
if [ -z "$(git status --porcelain)" ]; then clean_tree=1; fi
cleanup() {
  if [ -n "$clean_tree" ]; then
    git checkout -q -- .
    git clean -fdq -- "$CONTRACT_TYPES"
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT

root_script() { node -e 'process.exit(require("./package.json").scripts?.[process.argv[1]] ? 0 : 1)' "$1"; }
turbo_tasks() { node -e 'const t = require("./turbo.json").tasks; console.log(process.argv.slice(1).filter((n) => n in t).join(" "))' "$@"; }

failed=""

echo "== Prettier on the changed files"
git diff --name-only -z --diff-filter=ACMR "$base" HEAD | xargs -0 -r pnpm exec prettier --check --ignore-unknown \
  || failed="$failed prettier"

if root_script ci:lint:manifests; then
  echo "== Manifest lint"
  pnpm ci:lint:manifests || failed="$failed manifests"
fi

tasks=$(turbo_tasks ci:lint ci:typecheck ci:unused ci:i18n)
if [ -n "$tasks" ]; then
  echo "== turbo run $tasks (affected packages)"
  pnpm exec turbo run $tasks $TURBO_FLAGS || failed="$failed turbo"
fi

if [ -n "$(turbo_tasks contract:validate-types)" ]; then
  echo "== API contract types (when @synthesia/api-contracts is affected)"
  # --force: a cache hit would replay the log without regenerating the types this step inspects.
  contract_failed=""
  pnpm exec turbo run contract:validate-types --force $TURBO_FLAGS || contract_failed=1
  git ls-files --others --exclude-standard -- "$CONTRACT_TYPES" >"$scratch/untracked-contract-types"
  if [ -n "$contract_failed" ] || [ -s "$scratch/untracked-contract-types" ]; then
    failed="$failed contracts"
    if [ -s "$scratch/untracked-contract-types" ]; then
      echo "New generated API contract files are not committed:"
      sed 's/^/  /' "$scratch/untracked-contract-types"
    fi
    removed=$(git diff --numstat -- "$CONTRACT_TYPES" | awk '{ n += $2 } END { print n + 0 }')
    if [ "$removed" -gt 0 ] && [ -n "$(git diff --name-only "$base" HEAD -- "$CONTRACT_TYPES")" ]; then
      waiting=1
      echo "WAITING-ON-BACKEND: the branch's generated API types in $CONTRACT_TYPES are ahead of the published" \
        "spec packages (regenerating removes $removed lines). This turns green once the backend PR is merged," \
        "its spec is published and 'pnpm api-contracts contract:update <service>' bumps the version."
    fi
  fi
fi

if root_script test:affected; then
  echo "== Jest: the tests related to the changed files (pnpm test:affected)"
  pnpm test:affected --base "$base" --concurrency 2 -- --ci --maxWorkers=25% --passWithNoTests || failed="$failed tests"
fi

[ -z "$failed" ] && { echo "== All checks passed"; exit 0; }
echo "== Failed:$failed"
[ "$failed" = " contracts" ] && [ -n "${waiting:-}" ] && exit 3
exit 1
