# Large repos (EnactServices, TTVPlatform)

- **The repo's rules and skills.** Agents load the repo's CLAUDE.md files and
  `.claude/rules` like an interactive session, and get the Skill tool for its
  skills and commands. What Claude Code never reads by itself (Cursor rules
  without a `.claude/rules` twin, `AGENTS.md` files without a CLAUDE.md beside
  them) is listed in a `repo-guidance.md` every agent is pointed to. The
  planner names the rules and skills that apply in each ticket's guidance.
- **Exploring.** Agents get the Task tool, so they can send an Explore
  subagent through a monorepo and keep only its conclusion.
- **Worktrees.** The project's "files copied into each worktree" (only
  gitignored ones, so a copy can never be committed) and the ignored files the
  repo's `.worktreeinclude` names are copied into every new worktree, then the
  setup command runs there once. If setup fails, the ticket waits for you
  instead of burning an agent run, and setup runs again on the next attempt.
- **Your toolchain.** Setup, checks, git and agents run with your login
  shell's `PATH`, so asdf, mise or Homebrew pick each repo's own node, pnpm or
  python versions, whatever the factory itself was started with.
- **Env and secrets.** Variables from copied env files are in every agent's
  shell (minus anything that would change how Claude, git or gh
  authenticate), so an agent can `curl` a dev API with `$LAGO_API_KEY` without
  ever reading the file. Secret-looking values are replaced by
  `[redacted NAME]` in run events, agent output files and the probe's log.
- **Web and reference code.** Every agent can WebFetch and WebSearch docs, and
  reads the project's reference folders (for example `lago-api` and
  `lago-python-client` for EnactServices) through `--add-dir`.
- **Checks on what changed.** The checks command, the setup command and the
  agents get `$FACTORY_BASE` (the ref the branch is diffed against) and
  `$FACTORY_BRANCH`, so the gate can check only what the branch touched, for
  example `uv run prek run --from-ref "$FACTORY_BASE" --to-ref HEAD` in
  EnactServices.
- **The gate runs the tests of the changed files; agents run none.** The
  checks command may run a tight selection (EnactServices'
  `scripts/checks/enactservices.sh` runs the tests of the changed files and
  their direct importers, a median of about 240 of 44,000), so CI is
  predicted before anything is pushed; CI keeps the wide selection. Agents
  never run tests or the checks command, only the project's quick checks;
  when tests fail, the fixer runs exactly those to reproduce and confirm. The
  factory's own tests are separate: `pnpm test` must pass.
- **Test databases per gate.** Gates get `$FACTORY_SLOT` (1 to 15), unique
  among the gates running at once, so a checks script can give each its own
  Redis database and its worktree its own Mongo database instead of queueing
  every test run on one machine-wide lock.
- **Exit codes the gate understands.** 0 passes, 1 fails and goes to a fixer,
  75 means trouble outside the code (a service down, a lock wait ran out, the
  package index refused auth): the gate runs again in a few minutes and no
  fixer starts. 126 or 127 means the command cannot run, and the ticket waits
  for you. 3 records a distinct waiting result and says what work outside the repo must finish (a line
  starting with `WAITING-ON-`, such as TTVPlatform types ahead of the
  published backend spec): the PR opens and waits, and no fixer starts.

