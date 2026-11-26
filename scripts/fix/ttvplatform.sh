#!/usr/bin/env bash
# TTVPlatform's fix command: the autofixers on the branch's own changes. It never commits: the server
# commits what changed, then runs the checks. Exit 0 whether or not anything changed, 1 when eslint
# crashes or a generator leaves an incomplete result, 126/127 when it cannot run.
#   - prettier --write and eslint --fix on the changed files (eslint per workspace, with its config)
#   - i18n extraction and compilation in the changed packages that define an `i18n` script
#   - API contract types, when the branch changes the spec versions in api-contracts' package.json
set -uo pipefail

[ -n "${FACTORY_BASE:-}" ] || { echo "FACTORY_BASE is not set."; exit 126; }
base=$(git merge-base "$FACTORY_BASE" HEAD) || { echo "No merge base between $FACTORY_BASE and HEAD."; exit 126; }
[ -d node_modules ] || { echo "No node_modules here: the project's setup command (pnpm install) has not run."; exit 126; }
[ -r turbo.json ] && node -e 'const tasks = require("./turbo.json").tasks; process.exit(tasks && typeof tasks === "object" ? 0 : 1)' 2>/dev/null \
  || { echo "turbo.json is not readable or does not define tasks."; exit 126; }
export TURBO_CACHE_DIR="${FACTORY_HOME:-$HOME/.software-factory}/cache/turbo-ttvplatform"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
crashed=""

package_script() { node -e 'process.exit(require(process.argv[1]).scripts?.[process.argv[2]] ? 0 : 1)' "$PWD/$1/package.json" "$2"; }
workspace_of() {
  local dir
  dir=$(dirname "$1")
  while [ "$dir" != . ] && [ ! -f "$dir/package.json" ]; do dir=$(dirname "$dir"); done
  echo "$dir"
}

git diff --name-only --diff-filter=ACMR "$base" HEAD >"$scratch/changed"

echo "== prettier --write on the changed files"
tr '\n' '\0' <"$scratch/changed" | xargs -0 -r pnpm exec prettier --write --ignore-unknown --log-level warn
[ $? -eq 127 ] && exit 127

echo "== eslint --fix on the changed files, per workspace"
grep -E '\.(js|jsx|mjs|cjs|ts|tsx)$' "$scratch/changed" | grep -vE '\.gen\.[a-z]+$' | while IFS= read -r file; do
  printf '%s\t%s\n' "$(workspace_of "$file")" "$file"
done | sort >"$scratch/by-workspace"
for workspace in $(cut -f1 "$scratch/by-workspace" | uniq); do
  [ "$workspace" != . ] && package_script "$workspace" ci:lint || continue
  echo "-- $workspace"
  awk -F'\t' -v ws="$workspace" '$1 == ws { print substr($2, length(ws) + 2) }' "$scratch/by-workspace" \
    | (cd "$workspace" && tr '\n' '\0' | CRASHED="$scratch/eslint-crashed" xargs -0 sh -c 'pnpm exec eslint --fix "$@"; [ $? -ge 2 ] && touch "$CRASHED"; exit 0' _)
  # eslint exits 1 for errors it cannot fix and 2 when it crashes; xargs' own exit code differs between BSD and GNU.
  [ -e "$scratch/eslint-crashed" ] && crashed="$crashed eslint($workspace)" && rm -f "$scratch/eslint-crashed"
done

echo "== i18n in the changed packages"
pnpm --filter "[$base]" --if-present run i18n || { echo "i18n generation failed; discarding its partial output."; exit 1; }

contracts=packages/api-contracts
if git diff --name-only "$base" HEAD -- "$contracts/package.json" | grep -q . && package_script "$contracts" contract:generate-types; then
  echo "== API contract types for the spec versions in $contracts/package.json"
  pnpm --filter @synthesia/api-contracts run contract:generate-types || { echo "API contract generation failed; discarding its partial output."; exit 1; }
fi

echo "== Changed by the fixers"
git status --short
[ -z "$crashed" ] || { echo "== Crashed:$crashed"; exit 1; }
exit 0
