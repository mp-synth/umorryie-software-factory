#!/usr/bin/env bash
# Checks prerequisites, installs dependencies and starts Postgres.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "docker is required"; exit 1; }
command -v git >/dev/null || { echo "git is required"; exit 1; }
command -v claude >/dev/null || [[ -x "$HOME/.local/bin/claude" ]] || echo "warning: claude CLI not found; set CLAUDE_BIN in .env"
command -v gh >/dev/null || echo "warning: gh CLI not found; pushing and PRs will be skipped"

pnpm install
docker compose up -d --wait db
echo
echo "ready:  pnpm dev    → UI on http://localhost:5173 (hot reload)"
echo "        pnpm start  → UI on http://localhost:4317"
