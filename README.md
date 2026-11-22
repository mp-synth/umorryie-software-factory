# Software Factory

A local control room for building features with Claude Code agents. You describe
an outcome; a planner turns it into a reviewed plan and small tickets; a fresh
arbiter approves it on your behalf; fresh agents build each ticket in its own git
worktree, a fresh reviewer judges every branch, and a fresh fixer handles findings,
failing checks and PR comments, with a fresh verifier approving every fix before it
is pushed or answered on the PR — all tracked in a local Postgres and visible live
in a dashboard. You review the draft PRs.

```
 brief ─▶ planner ─▶ plan reviewer ─▶ arbiter ─▶ ┌ executor ─▶ checks ─▶ reviewer ─┐ ─▶ draft PR for you
          (opus)      (opus)          (fable)    │   (opus)    (gate)    (opus)    │
                                     or re-plan  └ fixer ─▶ checks ─▶ verifier ◀───┘ CHANGES / red / PR comments
                                                   (opus · sonnet for CI/lint)  (opus) ─▶ push + replies
                                         any step that stops for you ─▶ arbiter (fable) ─▶ approve / retry / you
```

Every box is a **separate `claude -p` process with an empty context**. Agents
never inherit each other's conversation: each gets a short header of absolute
paths and reads only the files it needs (brief, plan, ticket, previous review…),
then writes exactly one output file whose first line is its verdict. The server —
not an agent — owns state, git, pushes, PRs and sequencing. That keeps every
step small, reproducible and re-runnable on its own.

## Quick start

Prerequisites: Node 20+, pnpm, Docker Desktop, git, the `claude` CLI (logged in),
and optionally `gh` (logged in) for pushing branches and opening PRs.

```bash
pnpm bootstrap  # checks tools, installs deps, starts Postgres in Docker
```

```bash
pnpm dev        # API on :4317, UI with hot reload on http://localhost:5173
```

Or build the UI once and serve everything from the API:

```bash
pnpm start      # http://localhost:4317
```

Then: **Projects → Add project**, pick a repo in the folder browser (or paste
a path) and a base branch, **New initiative**, write a brief, and watch the
planner work.

Adding a repo discovers how to work in it. A first guess comes from lockfiles
and package scripts at once; then a read-only Claude agent (Sonnet, about 20
seconds and $0.10) reads `CLAUDE.md`, `AGENTS.md`, the CI config and the
scripts, and proposes the setup command, a checks command (formatting, lint
and type checks scoped to `$FACTORY_BASE`, never tests), the gitignored files to copy into worktrees (`.env`), local
checkouts agents may read (an SDK and the service it calls), and what must be
running for the checks (Mongo, a registry login). Every field stays editable,
and **Re-run** in the edit dialog proposes fresh commands.

To try a project's environment without running an initiative:

```bash
pnpm --filter @factory/server probe EnactServices --diff-from origin/master~1 --prompt "Call the Lago API with the key from .env and find the endpoint in lago-api"
```

It makes a throwaway worktree, copies the files, runs setup and checks (diffed
against `--diff-from`), then starts an agent exactly as the factory would.

What a run looks like (the demo in `~/.software-factory/demo/todo-app`): a
4-ticket feature ("priorities and due dates" for a todo CLI) went plan → plan
review → approval → 4 builds (two in parallel, stacked) → checks → 4 reviews,
including one fresh executor resolving a merge conflict between two sibling
tickets and one fix round from owner feedback, for about $2.50 of agent time.
On a GitHub repo the same flow opens stacked draft PRs, posts each review on
its PR, leaves every PR in draft for you to mark ready, and **Fix all PRs** turns unresolved review
threads into a fix round (the factory's own comments are ignored). It skips every ticket with nothing
left to act on: no new review findings, failing checks or CI, conflicts, unanswered comments or feedback.

What lands on a PR is written for its reviewer, not for agents. A review is one
line (`Review round 2: CHANGES · checks passed · acceptance 3/4 met`) and one
numbered item per finding: severity, `path:line`, the claim, the failure
scenario and the suggested fix. The reviewer's evidence, summary, acceptance
table, notes and earlier-round bookkeeping stay in the factory. A verified fix
round posts `Fix round N`, its commits and one line per answered top-level
comment; thread replies are one or two sentences that end in a commit sha or a
`path:line`. Every agent whose text reaches people follows `agents/writing.md`.

## The arbiter: you only review PRs

The pipeline stops for a human in three places: a plan waiting for approval,
a planner with questions (or planning that failed), and a ticket that needs
you (an executor or fixer that reported BLOCKED, a review that still asks for
changes or checks that still fail after the round limit, a verifier that
blocked a fix twice, a rebuild that can't run, an agent that crashed or timed
out). With **Arbiter decides for you** on (the default), each of these starts a
fresh, read-only arbiter (Fable) that never saw the work. It reads why the step
stopped, the brief, what you said before, the latest output of every step and
the code, then writes one of three decisions:

- **APPROVE**: the plan is approved and its first wave starts building, or the
  ticket is marked approved and its dependents start. A ticket is never
  approved with failing checks, nothing committed or an unverified fix. When
  the PR's last review asked for changes, the PR gets one line saying why it
  was approved anyway.
- **RETRY**: its instructions go to a fresh planner, executor or fixer as
  binding feedback, labelled as the arbiter's (it answers planner questions by
  number). A step that crashed runs again.
- **ESCALATE**: only for what you alone have (credentials, access, money,
  production data, a costly product call the brief doesn't inform). The ticket
  keeps waiting with the arbiter's one-line question on top of the reason.

The arbiter decides at most **Arbiter decisions in a row** times (3) per plan or
ticket since your last message or action there; after that it waits for you.
Anything you do on that plan or ticket stops a running arbiter, and a decision
that lands after you acted is not applied. While it decides, the ticket shows
**Arbiter deciding** instead of **Needs you**, and the dashboard doesn't count
it as waiting on you.

Every 15 minutes a PR sweep does the same on its own for every open factory PR
across all initiatives, and for every open PR you opened yourself in a
project's GitHub repo. Those are adopted into the project's **Open PRs**
initiative: the fixer works on a local `factory/pr-<n>` worktree that tracks
the PR's branch, pushes verified fixes to that branch (never force), and never
rebuilds your PR. Like any initiative, it reviews each fixed branch and posts
the review on the PR unless you switch that off in its Autopilot card. Archive a project's Open PRs initiative to stop
adopting from that repo. For each PR, a merge conflict, failing CI that has finished (tests,
lint) or unanswered review comments start a fresh fixer, which goes through
checks and the verifier like any other fix. A PR being fixed carries a
"sweep fixing" mark on its ticket row, so the next sweep leaves it alone; the
mark clears when the fix chain finishes and expires after 45 minutes either
way. The sweep skips tickets that need you, and never starts a fixer twice for
the same PR state (same head commit, checks, threads and comments). Turn it off
or run it now in **Settings**. **More → Fix PRs now** on an initiative runs the
same sweep for that initiative right away; it also retries a PR state the loop
already handled and includes tickets that need you.

Every initiative works in its own lane, side by side with the others, the way
tasks spawned in the cloud would: 15 initiatives all move at once. The agent
pool is sized to this machine (four agents per core, less when memory runs out
first; 42 on an 11-core, 36 GB laptop), and a free slot always goes to the
initiative with the fewest agents, then each initiative's own **Parallel**
limit applies. An initiative never waits for another to start: one with work
and no agent gets one even when the pool is full (up to half the pool on top).
While the machine is short on CPU (load of 2 per core) or memory, new agents
wait, down to one per core and never below one per initiative; nothing running
is stopped. The Dashboard and Settings show the pool, what is running and
waiting, and when it is held. Turn **Size the agent pool to this machine** off
in Settings for a fixed number, which is then a hard limit. The pool counts
only CPU and memory, not your Claude plan's rate limits or spend: if those
run out first, turn sizing off and pick a smaller number.

Each agent is a session of its own: a fresh process with no memory of earlier
steps, Claude's auto memory switched off so nothing carries over between
sessions or leaks in from your own, and a private scratch directory as
`TMPDIR` that is removed when it exits. The database allows only one active
agent per ticket or plan, and every initiative has its own branches, worktrees
and run folders. Per repo, only the quick git bookkeeping (registering or
removing a worktree, fetching) runs one at a time; checking files out, setup
commands and checks run in parallel, one per core, shared fairly between the
initiatives.

## What you can do in the UI

| Where | What |
|---|---|
| Dashboard | Every initiative with segmented progress, what is waiting on you, agents running now, total spend |
| Initiative → Plan | High-level overview first (goal, summary, success criteria, definition of done), then edge cases, test strategy, risks, assumptions, the plan review and the full plan.md on demand. Paths the plan names that do not exist at the base are listed for the plan reviewer (never a rejection). **Approve & build** or **Request changes** (your words go to a fresh planner as binding feedback). Answer the planner's questions when it is blocked |
| Initiative → Tickets | One row per ticket: status, verdict, PR, cost. Expand for what/goal/outcome, acceptance checks, guidance, branch/worktree, every agent run, and the latest output. **Run / Review / Fix** per ticket; **Run ready / Review all / Fix all PRs / Sync PRs** in bulk; edit a ticket before it starts; reset a ticket; mark approved/merged. The row shows the lines the ticket changed outside tests, lockfiles and files the repo marks `linguist-generated`, flagged when over 1.5 times its size budget (XS 50, S 200, M 500) |
| Initiative → Activity | The conversation with the agents. **Ask** starts a read-only advisor that answers from the code; **Feedback** re-plans (before approval) or goes to a fresh fixer (per ticket); **Note** just records |
| Initiative → Autopilot | Which steps run by themselves: plan review, build after approval, review after build, auto-fix, push & open draft PRs, post reviews on PRs, hold dependents until CI is green, the arbiter deciding for you; round limits, arbiter decisions in a row, parallelism and the model per step (Fable, Opus, Sonnet or Haiku) |
| Sidebar | The theme switcher (system, light or dark) sits next to the live indicator |
| Run drawer | Live stream of any agent: tool calls with inputs and results, text, thinking, the checks log, cost/tokens/turns. Its output file, the exact prompt header, and a `claude --resume` command to continue that session in your terminal. **Stop** kills it |
| Agents | Every run across all initiatives, live |

## How a ticket moves

| Status | Meaning |
|---|---|
| proposed | In a plan you haven't approved |
| to do | Approved; starts when its dependencies are approved (or press Run) |
| building | Executor is working in `~/.software-factory/worktrees/...` on `factory/<initiative>-<id>/<nn>-<key>` |
| running checks | The project's checks command runs in the worktree. Red → fixer, which gets the failing lines and the path of the full log. Green → push + draft PR. If the command can't run at all (exit 126/127) the ticket goes to *needs you* instead of burning a fixer round. **Run checks** re-runs it by hand |
| built | Checked and waiting for review (when auto-review is off) |
| in review | A fresh reviewer reads `git diff <base>...HEAD` and the initiative's goal, success criteria and definition of done, verifies each finding, answers APPROVE or CHANGES. An over-budget ticket carries a Size note in the review header |
| changes requested | Waiting for a fixer (auto-fix runs it unless the round limit is reached) |
| fixing | A fixer gives every item a verdict before touching code (VALID / PARTIAL / INVALID / UNCONFIRMED / NEEDS-HUMAN): a bug is fixed only after it is traced and gets a test that would fail without the fix (written, not run: CI runs tests, and the fixer re-runs only the tests that failed in the PR's CI, before and after its fix); a claim is rejected only by pointing at the code. Rounds with only failing checks, CI or conflicts get a cheaper mechanical fixer that first checks whether the base branch fails the same way and lists flaky runs for one re-run. Fixes are committed locally; after the checks pass, a fresh **verifier** reads the commits and drafted replies. Approved: the factory pushes, replies in each review thread, answers top-level comments in one summary, and resolves every thread it fixed once the fix is on the PR (bot threads it rejects with a code pointer too; a human's disputed or partly fixed thread stays open for them). Blocked: the branch is reset and a fresh fixer retries once with the findings; a second block pushes nothing and waits for you. When only rewriting pushed commits would fix the branch (someone else's commit in its history), the fixer answers REBUILD: the factory builds the ticket again on a fresh `-vN` branch and closes the old PR once the new one opens, unless another ticket already builds on it or it was built 3 times. When a PR has nothing to act on, no agent is started |
| approved | The reviewer, or the arbiter over the reviewer's remaining findings, would merge it. The PR stays a draft until you mark it ready. Dependents start (with "Dependents wait for green CI" on, only once the PR's CI is green or has no checks; CI shows on the ticket row) |
| merged | Seen by Sync PRs (automatic every 5 min) or marked by you. Unblocks dependents. Its local worktree is removed, and its local branch too once no unmerged ticket is stacked on it |
| needs you | An agent reported BLOCKED, rounds ran out, or something failed. The reason is on the row. With the arbiter on, it decides first and the row shows **Arbiter deciding**; it stays **Needs you** only when the arbiter escalates or has used its decisions |

Dependent tickets are **stacked**: every group of tickets connected by
dependencies becomes one line in plan order, so each ticket branches from the
one just before it and its PR targets that branch. Tickets that need nothing
from the others branch from the base branch and build in parallel. On GitHub
the factory links those PRs into a native stacked PR as soon as the PR opens,
and Sync PRs links any it missed (your own PRs in Open PRs too, when one targets
another's branch). A stacked ticket's row is marked **stacked**.

The stack keeps itself in sync. When a PR's branch changes (a verified fix is
pushed, someone pushes to it, Sync PRs sees a merge), the factory merges it into
each idle PR above it and pushes, level by level, so every PR builds on the
latest code below it. A merge that conflicts goes to a fresh fixer with the
conflict as feedback; with auto-fix off, or when a fixer already tried that same
merge, the ticket waits for you. Once everything below a PR has merged, the PR
targets the base branch. When GitHub rewrites a branch itself (**Rebase stack**,
or the rebase after the bottom PR merges), the factory's copy follows it unless
it holds unpushed commits. The factory merges rather than rebases, so GitHub may
ask you to **Rebase stack** before it merges a stack.

**More → Auto-merge PRs** merges an initiative's PRs for you, bottom-up. Every
5 minutes it marks each approved ticket's draft PR ready for review, and adds
the lowest open PR of each stack to the merge queue once GitHub says it can
merge (approved, required checks green, no conflicts). When that PR merges,
the next one becomes the lowest and follows. A lowest PR that conflicts with
the base branch or fails CI gets a fresh fixer, then joins the queue once it
is green. A PR that leaves the queue twice at the same commit is not added
back until it changes; the activity feed says so. Only tickets the factory's
review approved are merged, and GitHub's own rules (approvals, required checks)
still apply.

## Where things live

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
  reboot, or you stopped the agents with the server, see Development). Those are
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
  `tickets/<nn>-<key>/ticket.md`, `round-N/build.md|checks.md|review.md|fix.md`).
- **`~/.software-factory/worktrees/`**: one git worktree per ticket, removed
  once the ticket is merged. Your own checkout is never modified.
- **`~/.software-factory/spool/<run id>/`**: one folder per run that has a
  process in flight: what was launched, its raw output (`stdout.log`,
  `stderr.log`) and, once it ends, its exit code. The server reads the run's
  events from here, so they survive a restart. Removed when the run ends.
- **`agents/*.md`**: the role instructions for planner, plan reviewer, executor,
  reviewer, fixer, mechanical fixer, fix verifier, arbiter and advisor, plus the
  shared `repo-rules.md` (every agent), `code-style.md` (agents that write or
  judge code) and `writing.md` (agents whose text reaches people: executor,
  reviewer, fixer, arbiter). Edit them to change how the factory thinks.

## Guardrails

- Agents never push, merge, rebase shared history or talk to GitHub. The server
  pushes only `factory/*` branches and never force-pushes. It merges a PR only
  through the merge queue with **Auto-merge PRs** on; otherwise you merge.
- Agents only add commits. The server notes HEAD before every build and fix;
  if an agent rewrote a commit it didn't make (say, `--amend` after a
  pre-commit hook cancelled its commit), its changes go back on top as a new
  commit before the checks run or anything is pushed.
- Every agent has the CLI deny rules for `git push`, `git stash` and the `gh`
  commands that create, edit, comment on, review, merge or close PRs and issues;
  agents that must not change code also can't `git commit`, `reset` or `rebase`.
  If a review or verify still changes its worktree (HEAD or a tracked file), the
  run fails and the ticket is handed to you; nothing is restored for you.
- Agents start clean: no MCP servers, no Claude auto memory and (by default)
  no user-level hooks or plugins, so nothing pollutes their context. The
  repo's own CLAUDE.md, `.claude/rules`, skills and `.claude/` settings still
  apply (see below).
- A step passes only if its output file starts with a known verdict line (for
  example `VERDICT: APPROVE`) and the agent finished without an error. Anything
  else fails the run and hands the ticket to you; nothing is retried.
- Text from GitHub reaches agents only as quoted data in a file, and the
  factory's own PR comments are marked so they never loop back. Every
  comment and thread reply the factory posts starts with
  **Claude Bot Automation**. A review
  thread whose last word is yours or the factory's waits for its reviewer and
  isn't fed to a fixer again; failing CI waits until every check has finished;
  human-gated checks (Code review gate, Meticulous) are ignored, and so are
  cancelled jobs that a later run of the same workflow replaced. Top-level
  comments from report bots (GitHub Actions, Meticulous, Codecov, Sonar,
  Vercel, Netlify, Linear) never start a fixer, with or without a `[bot]`
  suffix (the list is in **Settings**), nor does Bugbot's summary review body,
  since each of its findings is an inline thread. Every other review body,
  including a Cursor automation's, is triaged like a comment. When a fixer does start,
  `pr-comments.md` lists what was dropped and why. After a fix round that
  commits nothing, an approved branch is not reviewed again.
- Nothing a fixer did reaches the PR before the checks pass and a verifier
  approves it. Fix rounds count toward the round limit, including retries
  after a block, so a fix that keeps breaking stops and waits for you.
- plan.json is validated (schema, bullet lengths, sizes, dependency DAG) before
  any ticket exists; an invalid plan goes back to a fresh planner with the errors.
- The checks command comes from the project settings in the DB, so a branch can't
  change the checks it is judged by. Checks failures never reach a reviewer.
- No secrets: Postgres listens on loopback only with trust auth, so there is no
  password to store. Agents use your existing `claude` login.
- PRs are opened as drafts, and the factory marks them ready only with
  **Auto-merge PRs** on; otherwise that is your call. Each has a short
  imperative title that states the outcome and a description written by the
  executor under two headings: **Why**, one to three sentences on what was
  broken or missing and what it caused, and **What**, one to four bullets on
  what the code does now. No other headings, checklists, file lists or ticket
  numbers; if the executor's text breaks those rules the ticket's own goal and
  what are used instead.
  Dependent tickets open stacked PRs, linked as a stack on GitHub.
- `agents/code-style.md` holds the owner's code rules (no duplication, no
  comments, no change-comments, no redundant docstrings). The executor, fixer
  and reviewer get it with every prompt, and the reviewer treats violations as
  major findings.

## Large repos (EnactServices, TTVPlatform)

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

## Development

`pnpm dev` runs the server without file watching. A restart does not stop the
agents, so restart as often as you like while you change the factory, or use
`pnpm --filter @factory/server dev:watch` to restart on every save.

Only one server runs per database: a second one started with the same
`DATABASE_URL` exits at once with a message, before it migrates anything or
touches a run.

- **Ctrl-C** (SIGINT), `kill` (SIGTERM, which `dev:watch` sends) and a crash stop
  only the server. Running agents, checks and setup commands keep going and the
  next start picks them up; a step that had not started its agent or checks yet
  is queued again and starts over, as often as you restart (see "Where things
  live"). On Ctrl-C and `kill` the server first waits up to 15 seconds for steps
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

Layout: `server/` (Fastify + postgres.js, the orchestrator in
`server/src/pipeline/engine.ts`, the `claude` runner in
`server/src/agents/claude.ts`), `web/` (React + Vite + Tailwind + TanStack
Query, live via SSE), `shared/` (types), `agents/` (role prompts and the shared
code rules).

Inspired by zazencodes' software-factory v2 (scripts own state, one file per
agent, gate before review), the project-harness design (fresh agent per step,
plan reviewer, triage-before-fix, stacked PRs) and pr-autofix (mechanical vs
review fixes, PR state snapshots).
