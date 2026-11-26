# Development

`pnpm dev` runs the server without file watching. A restart does not stop the
agents, so restart as often as you like while you change the factory, or use
`pnpm --filter @factory/server dev:watch` to restart on every save. With the
launchd jobs installed, `pnpm service promote` loads your changes once they
typecheck and the server tests pass; `pnpm service restart` restarts without
those checks: it sends the server
SIGTERM (and a second one if it is still waiting after 30 seconds), and launchd
starts it again from the checkout.

Only one server runs per database: a second one started with the same
`DATABASE_URL` exits at once with a message, before it migrates anything or
touches a run.

- **Ctrl-C** (SIGINT), `kill` (SIGTERM, which `dev:watch` sends) and a crash stop
  only the server. Running agents, checks and setup commands keep going and the
  next start picks them up; a step that had not started its agent or checks yet
  is queued again and starts over, as often as you restart (see
  [Where things live](where-things-live.md)). On Ctrl-C and `kill` the server first waits up to 15 seconds for steps
  that are just finishing, so none is cut off between recording its result and
  queueing the next step; pressing Ctrl-C again a second or more later skips
  the wait (the copies of one Ctrl-C that `pnpm` and `tsx` pass on do not).
  After a crash or
  `kill -9`, a step caught in that moment is put back at startup and waits for
  you.
- **Ctrl-\\** (SIGQUIT) stops the server and every running agent, checks command
  and setup command. So does any exit when the server was started with
  `FACTORY_STOP_AGENTS_ON_EXIT=1`. Steps stopped this way are marked interrupted
  at the next start and queued again once, as every restart used to do; a step
  stopped in its setup command is queued again and runs the setup from the start.
- **Stop** on a run in the UI stops that run's process, its setup command
  included, whether or not the server that started it is still the one running.
- Changes to the server's own code, and new migrations, apply to the steps that
  start after the restart. A run that was already in flight keeps the agent it
  has; only its follow-up work runs on the new code.

```bash
pnpm typecheck
pnpm test           # plan validation + DAG ordering
pnpm db:psql        # poke at the data
pnpm metrics        # read-only queries over the real runs (scripts/metrics.sql)
pnpm db:reset       # wipe the database volume
```

### Evaluating the judges

Most reviews and verifies approve, which alone says nothing about whether the
judges are strict enough. When you change `agents/reviewer.md` or
`agents/verifier.md`, measure them by hand on a small synthetic repo (built in
the temp directory, never a real project) with known defects: seven review
cases (one clean control, six defects such as an off-by-one, a missing await, a
weakened test, a missing authorization check, an out-of-scope edit and broken
code rules) and five verify cases (one clean fix round, four blocked ones).
It never touches the database or GitHub and is never part of the pipeline.

```bash
pnpm --filter @factory/server eval --role review --dry-run   # the cohort and the fixtures, no agent
pnpm --filter @factory/server eval --role review --role-file /path/to/variant.md --compare agents/reviewer.md
```

Each task is one fresh agent on one fixture, run one at a time, graded without
a model: the verdict must match and, for a defect case, the judge's findings
(the `## Findings` section, plus `## Reason` for a verify) must name the
defective file or one of the markers the case declares. `--repeats` (default 2) repeats every case, `--cases a,b` picks cases,
`--model` defaults to the role's factory model, and `--out` defaults to a
timestamped folder under `~/.software-factory/evals/` that gets `report.md`,
`report.json` and every task's output. The report gives the catch rate per
defect kind, the false-alarm rate on the clean control, cost and time per
arm, and, with two arms, the paired difference over the pairs both arms
finished. A task that errored, timed out or wrote no verdict is blocked, and a
task that never ran (an interrupted or crashed run) is missing: the rates are
then withheld, the blocked and missing tasks listed, and the command exits 1. Cases every run passed
or that disagree between repeats are flagged, since they show nothing.

A real run costs about $0.28 per review task and $0.26 per verify task at the
measured averages: roughly $4 for the default review cohort (14 tasks) and
$2.60 for the verify cohort (10), double with `--compare`.

`--compare-model` and `--compare-effort` make the second arm differ in model or
effort instead of role file (`--effort` sets the first arm's), so a cheaper
configuration is measured on the same cases, interleaved, with the paired
difference in the report:

```bash
pnpm --filter @factory/server eval --role verify --compare-model sonnet --repeats 4
pnpm --filter @factory/server eval --role review --compare-effort medium --repeats 3
```

Steps without synthetic cases (the arbiter, steering, the plan reviewer) are
measured by replaying the real runs they made:

```bash
pnpm --filter @factory/server replay --kind arbitrate --models fable,opus --repeats 3
```

Every succeeded run of that kind is re-run once per model and repeat, each in
its own sandbox that shows only the past: a copy of the initiative folder as it
stood when the run started (later rounds and the run's own decision left out,
the initiative's plan.md taken from the round current then), a private git
repository with the project's branches wound back to that moment, a worktree
from it for the run's checkout, the main checkout and every other worktree its
inputs name, and its stored prompt and inputs pointed at those, with today's
role prompt, tools and environment. GitHub is out of reach (a logged-out `gh`,
no git credentials), since it shows how things turned out; the linked PR
checkouts are left out for the same reason. Inputs that could only be copied as
they are now are listed per case. The report gives, per model, how often it
reached the original verdict and agreed with itself across repeats, how often
the models agree with each other and on which cases they differ, and cost and
time; `outputs/<case>/<model>-<repeat>.md` holds every replay's file. It reads
the database and never writes it. A step that relied on GitHub state then (a
PR's CI, its threads) has none now, so compare the models with each other there
rather than with the original verdict. Eval and replay agents count as "Judge
evals" in Usage.

Replays run every case once with each model before any repeat, so `--max n`
(run only the first n) keeps whole cases: with two models, `--max 100` is 50
cases once each, which compares the models but not their consistency. To cut a
running replay short, stop it, then rebuild its report from the replays that
belong to the cut:

```bash
pnpm --filter @factory/server replay --report --out <dir> --max 100
```

Layout: `server/` (Fastify + postgres.js, the orchestrator in
`server/src/pipeline/engine.ts`, the `claude` runner in
`server/src/agents/claude.ts`), `web/` (React + Vite + Tailwind + TanStack
Query, live via SSE), `shared/` (types), `agents/` (role prompts and the shared
code rules).

Inspired by zazencodes' software-factory v2 (scripts own state, one file per
agent, gate before review), the project-harness design (fresh agent per step,
plan reviewer, triage-before-fix, stacked PRs) and pr-autofix (mechanical vs
review fixes, PR state snapshots).
