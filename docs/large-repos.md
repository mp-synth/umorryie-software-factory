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
- **A project's tests run in its CI, not in the factory.** No agent runs test
  files or suites in the repos it works on while building, reviewing or
  verifying, and discovered gates hold no tests. When tests fail in the PR's
  CI, the fixer runs exactly those, to reproduce the failure and to confirm
  its fix. The factory's own tests are separate: `pnpm test` must pass.

