#!/usr/bin/env bash
# Runs the live factory from this checkout as two macOS launchd jobs: the API on
# :4317 and the UI with hot reload on :5173. They start at login, come back after
# a crash, and do not belong to any terminal or Claude session, so closing one
# never takes the factory down.
#
#   pnpm service install          start both, and the watch that restarts the server
#                                 onto new code, now and at every login
#   pnpm service restart          load server changes (agents keep running);
#                                 `restart web` or `restart all` for the UI too
#   pnpm service status           what runs, since when, and whether the server
#                                 is running older code than the checkout
#   pnpm service logs [web|watch] follow the server (or UI, or watch) log
#   pnpm service stop | start     take both down until the next login, or bring them back
#   pnpm service uninstall        remove both jobs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="local.software-factory"
AGENTS_DIR="$HOME/Library/LaunchAgents"
# The jobs never get FACTORY_HOME, so the service always lives in the default home,
# whatever a throwaway server in the calling shell uses.
LOG_DIR="$HOME/.software-factory/logs"
DOMAIN="gui/$(id -u)"
JOBS=(server web watch)
LOG_LIMIT=10485760
WATCH_EVERY=5
WATCH_QUIET=20

die() { echo "service: $*" >&2; exit 1; }
label() { echo "$PREFIX.$1"; }
plist() { echo "$AGENTS_DIR/$(label "$1").plist"; }
port() { case "$1" in server) echo 4317 ;; web) echo 5173 ;; esac; }
loaded() { launchctl print "$DOMAIN/$(label "$1")" >/dev/null 2>&1; }
job_pid() { { launchctl print "$DOMAIN/$(label "$1")" 2>/dev/null || true; } | awk '$1 == "pid" { print $3; exit }'; }
listener() { [[ -n "$(port "$1")" ]] || return 0; lsof -nP -t -iTCP:"$(port "$1")" -sTCP:LISTEN 2>/dev/null | head -1 || true; }
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

# The PATH the jobs get: this shell's, without the folders `pnpm run` adds.
job_path() { tr ':' '\n' <<<"$PATH" | grep -v -E '/node_modules/|/node-gyp-bin$' | awk 'NF && !seen[$0]++' | paste -sd: -; }

# Waits until the job's own process listens on its port (the watch has none).
wait_up() {
  local job="$1" seconds="$2" pid
  for ((i = 0; i < seconds; i++)); do
    pid="$(job_pid "$job")"
    [[ -n "$pid" && ( -z "$(port "$job")" || "$(listener "$job")" == "$pid" ) ]] && return 0
    sleep 1
  done
  return 1
}

wait_gone() {
  local pid="$1" seconds="$2"
  for ((i = 0; i < seconds; i++)); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
  done
  return 1
}

# A bootstrap right after a bootout fails while launchd is still tearing the old job down.
wait_unloaded() {
  local job="$1"
  for ((i = 0; i < 45; i++)); do
    loaded "$job" || return 0
    sleep 1
  done
  die "the $job job is still unloading after 45 s"
}

unload() {
  launchctl bootout "$DOMAIN/$(label "$1")" 2>/dev/null || true
  wait_unloaded "$1"
}

# Copy and truncate, so a process that keeps the log open keeps writing to it.
rotate() {
  local log="$1"
  [[ -f "$log" && $(stat -f %z "$log") -gt $LOG_LIMIT ]] || return 0
  cp -f "$log" "$log.1" && : >"$log"
}

# Entry point of each launchd job.
run() {
  local job="$1" log="$LOG_DIR/$1.log"
  mkdir -p "$LOG_DIR"
  rotate "$log"
  exec >>"$log" 2>&1
  echo "--- $(date '+%Y-%m-%d %H:%M:%S') starting the $job from $ROOT ($(git -C "$ROOT" branch --show-current))"
  case "$job" in
    server)
      local out
      if ! out="$(cd "$ROOT" && docker compose up -d --wait db 2>&1)"; then
        echo "$out"
        die "Postgres did not come up (is Docker running?); launchd tries again in 10 s"
      fi
      deleted_files >"$LOG_DIR/server.started"
      cd "$ROOT/server"
      exec node --import tsx src/index.ts
      ;;
    web)
      cd "$ROOT/web"
      exec node node_modules/vite/bin/vite.js --strictPort
      ;;
    watch) watch ;;
    *) die "run server|web|watch" ;;
  esac
}

write_plist() {
  local job="$1" abandon="false" limits=""
  # Agents, checks and setup commands are detached and outlive a server restart;
  # launchd must not clean up the server's process group when it exits.
  [[ "$job" == server ]] && abandon="true"
  local files; files="$(ulimit -n)"
  [[ "$files" =~ ^[0-9]+$ ]] && limits="<key>SoftResourceLimits</key><dict><key>NumberOfFiles</key><integer>$files</integer></dict>"
  cat >"$(plist "$job")" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(label "$job")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml "$ROOT/scripts/service.sh")</string>
    <string>run</string>
    <string>$job</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$(job_path)")</string>
    <key>SHELL</key><string>$(xml "${SHELL:-/bin/zsh}")</string>
    <key>LANG</key><string>$(xml "${LANG:-en_US.UTF-8}")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ExitTimeOut</key><integer>40</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>AbandonProcessGroup</key><$abandon/>
  $limits
  <key>StandardOutPath</key><string>$(xml "$LOG_DIR/launchd.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG_DIR/launchd.log")</string>
</dict>
</plist>
EOF
  plutil -lint -s "$(plist "$job")"
}

install() {
  [[ "$(uname)" == Darwin ]] || die "launchd is macOS only; use pnpm dev or pnpm start elsewhere"
  local dirs; dirs="$(git -C "$ROOT" rev-parse --path-format=absolute --git-dir --git-common-dir)"
  [[ "$(sed -n 1p <<<"$dirs")" == "$(sed -n 2p <<<"$dirs")" ]] || die "install from the main checkout, not a worktree"
  [[ "$(git -C "$ROOT" branch --show-current)" == main ]] || die "check out main first: the live factory runs from main"
  [[ -d "$ROOT/server/node_modules/tsx" && -d "$ROOT/web/node_modules/vite" ]] || die "run pnpm install first"
  command -v node >/dev/null || die "node is not on PATH"

  mkdir -p "$AGENTS_DIR" "$LOG_DIR"
  for job in "${JOBS[@]}"; do
    unload "$job"
    local other; other="$(listener "$job")"
    if [[ -n "$other" ]]; then
      echo "  :$(port "$job") is held by pid $other ($(ps -o command= -p "$other" | cut -c1-80))."
      echo "  The $job job keeps retrying every 10 s and takes over once that process stops."
    fi
    write_plist "$job"
    launchctl bootstrap "$DOMAIN" "$(plist "$job")"
  done
  for job in "${JOBS[@]}"; do
    wait_up "$job" 90 || echo "  the $job is not listening yet; see: pnpm service logs $job"
  done
  status
}

uninstall() {
  for job in "${JOBS[@]}"; do
    unload "$job"
    rm -f "$(plist "$job")"
  done
  echo "Removed the jobs. Running agents keep going; start the factory with pnpm dev or pnpm service install."
}

stop() {
  for job in "${JOBS[@]}"; do unload "$job"; done
  echo "Stopped until the next login or pnpm service start. Running agents keep going."
}

start() {
  for job in "${JOBS[@]}"; do
    [[ -f "$(plist "$job")" ]] || die "not installed; run pnpm service install"
    loaded "$job" || launchctl bootstrap "$DOMAIN" "$(plist "$job")"
  done
  for job in "${JOBS[@]}"; do wait_up "$job" 90 || echo "  the $job is not listening yet; see: pnpm service logs $job"; done
  status
}

restart_lock() {
  local lock="$LOG_DIR/restart.lock"
  for ((i = 0; i < 180; i++)); do
    if shlock -f "$lock" -p $$; then
      trap 'rm -f "$LOG_DIR/restart.lock"' EXIT
      return 0
    fi
    sleep 1
  done
  die "another restart has held $lock for 3 minutes"
}

restart() {
  restart_lock
  local jobs
  case "${1:-server}" in
    server | web | watch) jobs=("${1:-server}") ;;
    all) jobs=("${JOBS[@]}") ;;
    *) die "restart server|web|watch|all" ;;
  esac
  for job in "${jobs[@]}"; do
    loaded "$job" || die "the $job job is not running; run pnpm service install (or start)"
    local old; old="$(job_pid "$job")"
    if [[ -n "$old" ]]; then
      # The server waits up to 15 s for steps that are just finishing; a second
      # SIGTERM more than a second later skips that wait. launchd starts the
      # job again as soon as the old process is gone.
      launchctl kill SIGTERM "$DOMAIN/$(label "$job")"
      if ! wait_gone "$old" 30; then
        echo "  the $job is still stopping after 30 s; asking it to stop now"
        launchctl kill SIGTERM "$DOMAIN/$(label "$job")"
        wait_gone "$old" 15 || die "pid $old did not stop; see: pnpm service logs $job"
      fi
    else
      launchctl kickstart "$DOMAIN/$(label "$job")"
    fi
    if wait_up "$job" 90; then
      echo "Restarted the $job (pid $(job_pid "$job"))."
    else
      die "the $job did not come back within 90 s; see: pnpm service logs $job"
    fi
  done
}

# Files the running server loads. eval, replay and probe are separate scripts.
server_files() {
  { grep -E '\.(ts|mts|mjs|js|sql|json|yaml)$' || true; } |
    { grep -v -E '\.test\.ts$|^server/src/(eval|replay|probe)(\.ts$|/)' || true; }
}

# Tracked server files deleted from the checkout; the server's stamp holds the list it started with.
deleted_files() { { git -C "$ROOT" ls-files -d -- server shared || true; } | server_files | sort -u; }

# Server files changed or deleted since the running server started.
stale_files() {
  local stamp="$LOG_DIR/server.started"
  [[ -f "$stamp" ]] || return 0
  { git -C "$ROOT" ls-files -co --exclude-standard -- server shared package.json pnpm-lock.yaml || true; } | server_files |
    while read -r f; do [[ -f "$ROOT/$f" && "$ROOT/$f" -nt "$stamp" ]] && echo "$f"; done || true
  comm -13 "$stamp" <(deleted_files) | sed 's/$/ (deleted)/' || true
  [[ -f "$ROOT/.env" && "$ROOT/.env" -nt "$stamp" ]] && echo ".env" || true
}

# Why the checkout is not in a state to restart onto, if it is not.
checkout_busy() {
  local git_dir; git_dir="$(git -C "$ROOT" rev-parse --absolute-git-dir)"
  [[ "$(git -C "$ROOT" branch --show-current)" == main ]] || { echo "the checkout is not on main"; return 0; }
  for f in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do
    [[ -e "$git_dir/$f" ]] && { echo "a git operation is in progress ($f)"; return 0; }
  done
  if [[ "$ROOT/pnpm-lock.yaml" -nt "$ROOT/node_modules/.modules.yaml" ]]; then
    echo "pnpm-lock.yaml changed; run pnpm install"
    return 0
  fi
  return 1
}

newest_change() {
  local newest=0 t
  while read -r f; do
    t="$(stat -f %m "$ROOT/$f" 2>/dev/null || echo 0)"
    ((t > newest)) && newest=$t
  done <<<"$1"
  echo "$newest"
}

fingerprint() { while read -r f; do stat -f '%m %z %N' "$ROOT/$f" 2>/dev/null || echo "$f"; done <<<"$1" | shasum | cut -c1-40; }

# Restarts the server onto the checkout's code once the changes have been quiet for
# WATCH_QUIET seconds and typecheck; running agents keep going. A set of changes that
# cannot be loaded is reported once and retried when it changes again.
WATCH_SKIPPED=""
watch_once() {
  [[ -n "$(job_pid server)" ]] || return 0
  local stale; stale="$(stale_files)"
  [[ -n "$stale" ]] || { WATCH_SKIPPED=""; return 0; }
  (($(date +%s) - $(newest_change "$stale") >= WATCH_QUIET)) || return 0
  local print; print="$(fingerprint "$stale")"
  [[ "$print" != "$WATCH_SKIPPED" ]] || return 0
  local busy out
  if busy="$(checkout_busy)"; then
    log "not restarting: $busy"
    WATCH_SKIPPED="$print"
    return 0
  fi
  if ! out="$(cd "$ROOT/server" && node node_modules/typescript/bin/tsc --noEmit -p . 2>&1)"; then
    log "not restarting: the server does not typecheck; it restarts once these are fixed"
    head -30 <<<"$out"
    WATCH_SKIPPED="$print"
    return 0
  fi
  log "restarting the server onto $(wc -l <<<"$stale" | tr -d ' ') changed file(s): $(head -5 <<<"$stale" | paste -sd, -)"
  if (restart server); then WATCH_SKIPPED=""; else WATCH_SKIPPED="$print"; fi
}

watch() {
  log "watching $ROOT: the server restarts onto new code $WATCH_QUIET s after the last change"
  while sleep "$WATCH_EVERY"; do
    for f in "$LOG_DIR"/{server,web,watch}.log; do rotate "$f"; done
    watch_once || true
  done
}

status() {
  local branch; branch="$(git -C "$ROOT" branch --show-current)"
  echo "checkout  $ROOT ($branch)"
  [[ "$branch" == main ]] || echo "          not on main: the live factory should run from main"
  for job in "${JOBS[@]}"; do
    local pid holder
    pid="$(job_pid "$job")"
    holder="$(listener "$job")"
    if ! loaded "$job"; then
      printf '%-9s not installed' "$job"
      [[ -n "$holder" ]] && printf ' (:%s is served by pid %s, outside launchd)' "$(port "$job")" "$holder"
      echo
    elif [[ -z "$pid" ]]; then
      echo "$(printf '%-9s' "$job") not running; launchd retries every 10 s (pnpm service logs $job)"
    else
      local since state
      since="$(ps -o lstart= -p "$pid" | sed 's/  */ /g; s/^ //; s/ *$//')"
      if [[ "$job" == watch ]]; then state="restarts the server onto new code"
      elif [[ "$holder" == "$pid" ]]; then state="on :$(port "$job")"
      else state="starting, :$(port "$job") not open yet"; fi
      echo "$(printf '%-9s' "$job") pid $pid, $state, since $since"
    fi
  done
  if [[ -n "$(job_pid server)" ]]; then
    local stale; stale="$(stale_files)"
    if [[ -n "$stale" ]]; then
      echo
      echo "The server is running older code: $(wc -l <<<"$stale" | tr -d ' ') file(s) changed since it started:"
      head -8 <<<"$stale" | sed 's/^/  /'
      if [[ -n "$(job_pid watch)" ]]; then
        echo "The watch restarts it once they have been quiet for $WATCH_QUIET s and typecheck; if it does not, see pnpm service logs watch."
      else
        echo "Run pnpm service restart to load them (agents keep running)."
      fi
    else
      echo "The server runs the current server code (UI and agents/*.md load live)."
    fi
  fi
}

logs() {
  local job="${1:-server}"
  [[ "$job" == server || "$job" == web || "$job" == watch ]] || die "logs server|web|watch"
  tail -n 60 -F "$LOG_DIR/$job.log"
}

case "${1:-status}" in
  run) run "${2:-}" ;;
  install) install ;;
  uninstall) uninstall ;;
  stop) stop ;;
  start) start ;;
  restart) restart "${2:-}" ;;
  status) status ;;
  logs) logs "${2:-}" ;;
  *) die "usage: pnpm service install|restart [server|web|watch|all]|status|logs [server|web|watch]|stop|start|uninstall" ;;
esac
