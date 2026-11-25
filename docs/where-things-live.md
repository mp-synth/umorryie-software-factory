# Where things live

- **Postgres (Docker, `127.0.0.1:54329`)**: projects, initiatives (brief, plan.md,
  plan.json, settings), tickets, runs (prompt, output, verdict, cost, tokens,
  session id), every streamed agent event, and the conversation. Survives
  restarts, and so does the work in flight: queued runs resume, and a running
  agent, checks command or project setup command keeps running while the server
  is down. Each one runs
  under a small supervisor process of its own, detached from the server, that
  writes its output to the spool folder below, enforces the run's timeout and
  records the exit code. At startup the server follows every such run again from
  where its stored events end, or collects the result if it finished in the
  meantime, and then does what the step would have done next (parse the verdict,
  keep the branch history, queue the next step) with the state the step saved
  before its agent started. Nothing is run or posted twice.
  A step the restart catches before its agent or checks started (creating the
  worktree, collecting PR state) has done no agent work, so the same run goes
  back in the queue and starts over, whatever Settings say and without counting
  as an interruption. What it repeats is safe to repeat: it waits for a checkout
  the stopped server left running and carries on with that worktree instead of
  creating it again, and a setup command that was running is followed to its end
  like an agent (its output is in the run's log), after which the step carries
  on. A stop you asked for (Ctrl-C, `kill`, `dev:watch`) can do this any number
  of times. Only a run caught this way for the sixth time by a server that died
  (a crash or `kill -9`) is marked interrupted, and its ticket waits for you, in
  case its setup is what brings the server down.
  A restart still interrupts a step whose agent or checks process is gone (a
  reboot, or you stopped the agents with the server, see [Development](development.md)). Those are
  marked interrupted and, unless **Resume steps interrupted by a restart** in
  Settings is off, queued again once per round (never an advisor question, nor a
  sweep's fixer, which the next sweep redoes). Otherwise the ticket waits with
  the reason "Interrupted when the factory server stopped." Tickets and plans
  left mid-step with no run are put back the same way at startup.
  Each run also records a hash of its exact role prompt, the Claude CLI version,
  the factory commit, and the base and head commits it worked on, so results can
  be compared across prompt edits, CLI upgrades and factory versions.
- **`~/.software-factory/initiatives/<slug>/`**: the files agents read and write
  (`brief.md`, `plan/round-N/plan.md|plan.json|plan-review.md`,
  `tickets/<nn>-<key>/ticket.md`, `round-N/build.md|checks.md|review.md|fix.md`,
  `steer/<run>/route.md`, and `retro/<run>/retro.md` next to the ticket or the
  initiative it covers).
- **`~/.software-factory/worktrees/`**: one git worktree per ticket, removed
  once the ticket is merged. Your own checkout is never modified.
- **`~/.software-factory/spool/<run id>/`**: one folder per run that has a
  process in flight: what was launched, its raw output (`stdout.log`,
  `stderr.log`) and, once it ends, its exit code. The server reads the run's
  events from here, so they survive a restart. Removed when the run ends.
- **`agents/*.md`**: the role instructions for planner, plan reviewer, executor,
  reviewer, fixer, mechanical fixer, fix verifier, arbiter, advisor, steering
  router and retro, plus the shared `repo-rules.md` (every agent),
  `code-style.md` (agents that write or judge code) and `writing.md` (agents
  whose text reaches people: executor, reviewer, fixer, arbiter). Edit them to
  change how the factory thinks. An accepted every-project rule lands in one of
  these files under `## Learned rules`.

