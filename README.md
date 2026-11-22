# Software Factory

A local control room for building features with Claude Code agents. You describe
an outcome; a planner turns it into a reviewed plan and small tickets; you approve;
fresh agents build each ticket in its own git worktree, a fresh reviewer judges
every branch, and a fresh fixer handles findings, failing checks and PR comments,
with a fresh verifier approving every fix before it is pushed or answered on the PR —
all tracked in a local Postgres and visible live in a dashboard.

```
 brief ─▶ planner ─▶ plan reviewer ─▶ YOU approve ─▶ ┌ executor ─▶ checks ─▶ reviewer ─┐ ─▶ draft PR ready
          (opus)      (opus)           or re-plan    │   (opus)    (gate)    (opus)    │
                                                     └ fixer ─▶ checks ─▶ verifier ◀───┘ CHANGES / red / PR comments
                                                       (opus · sonnet for CI/lint)  (opus) ─▶ push + replies
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

Up to 10 initiatives run side by side without slowing each other down. Agent
slots are shared fairly (every initiative gets an agent before any gets a
second, then each initiative's own **Parallel** limit applies), the database
allows only one active agent per ticket or plan, every initiative has its own
branches, worktrees and run folders, and git operations that touch a repo's
shared state (creating or removing worktrees, fetching) run one at a time per
repo. Keep **Agents running at once** in Settings at 10 or more for that.

## What you can do in the UI

| Where | What |
|---|---|
| Dashboard | Every initiative with segmented progress, what is waiting on you, agents running now, total spend |
| Initiative → Plan | High-level overview first (goal, summary, success criteria, definition of done), then edge cases, test strategy, risks, assumptions, the plan review and the full plan.md on demand. **Approve & build** or **Request changes** (your words go to a fresh planner as binding feedback). Answer the planner's questions when it is blocked |
| Initiative → Tickets | One row per ticket: status, verdict, PR, cost. Expand for what/goal/outcome, acceptance checks, guidance, branch/worktree, every agent run, and the latest output. **Run / Review / Fix** per ticket; **Run ready / Review all / Fix all PRs / Sync PRs** in bulk; edit a ticket before it starts; reset a ticket; mark approved/merged |
| Initiative → Activity | The conversation with the agents. **Ask** starts a read-only advisor that answers from the code; **Feedback** re-plans (before approval) or goes to a fresh fixer (per ticket); **Note** just records |
| Initiative → Autopilot | Which steps run by themselves: plan review, build after approval, review after build, auto-fix, push & open draft PRs, post reviews on PRs; round limits, parallelism and the model per step |
| Sidebar | The theme switcher (system, light or dark) sits next to the live indicator |
| Run drawer | Live stream of any agent: tool calls with inputs and results, text, thinking, the checks log, cost/tokens/turns. Its output file, the exact prompt header, and a `claude --resume` command to continue that session in your terminal. **Stop** kills it |
| Agents | Every run across all initiatives, live |

## How a ticket moves

| Status | Meaning |
|---|---|
| proposed | In a plan you haven't approved |
| to do | Approved; starts when its dependencies are approved (or press Run) |
| building | Executor is working in `~/.software-factory/worktrees/...` on `factory/<initiative>-<id>/<nn>-<key>` |
| running checks | The project's checks command runs in the worktree. Red → fixer. Green → push + draft PR. If the command can't run at all (exit 126/127) the ticket goes to *needs you* instead of burning a fixer round. **Run checks** re-runs it by hand |
| built | Checked and waiting for review (when auto-review is off) |
| in review | A fresh reviewer reads `git diff <base>...HEAD`, verifies each finding, answers APPROVE or CHANGES |
| changes requested | Waiting for a fixer (auto-fix runs it unless the round limit is reached) |
| fixing | A fixer gives every item a verdict before touching code (VALID / PARTIAL / INVALID / UNCONFIRMED / NEEDS-HUMAN): a bug is fixed only after it is traced and gets a test that would fail without the fix (written, not run: CI runs tests, and the fixer re-runs only the tests that failed in the PR's CI, before and after its fix); a claim is rejected only by pointing at the code. Rounds with only failing checks, CI or conflicts get a cheaper mechanical fixer that first checks whether the base branch fails the same way and lists flaky runs for one re-run. Fixes are committed locally; after the checks pass, a fresh **verifier** reads the commits and drafted replies. Approved: the factory pushes, replies in each review thread, answers top-level comments in one summary, and resolves every thread it fixed once the fix is on the PR (bot threads it rejects with a code pointer too; a human's disputed or partly fixed thread stays open for them). Blocked: the branch is reset and a fresh fixer retries once with the findings; a second block pushes nothing and waits for you. When only rewriting pushed commits would fix the branch (someone else's commit in its history), the fixer answers REBUILD: the factory builds the ticket again on a fresh `-vN` branch and closes the old PR once the new one opens, unless another ticket already builds on it or it was built 3 times. When a PR has nothing to act on, no agent is started |
| approved | Reviewer would merge it. The PR stays a draft until you mark it ready. Dependents start |
| merged | Seen by Sync PRs (automatic every 5 min) or marked by you. Unblocks dependents. Its local worktree is removed, and its local branch too once no unmerged ticket is stacked on it |
| needs you | An agent reported BLOCKED, rounds ran out, or something failed. The reason is on the row |

Dependent tickets are **stacked**: a ticket whose dependency isn't merged yet
branches from the dependency's branch and its PR targets it. A ticket with
several unmerged dependencies merges the others in; if their branches conflict,
the executor gets a `merge-deps.md` and resolves the conflict before building.

## Where things live

- **Postgres (Docker, `127.0.0.1:54329`)**: projects, initiatives (brief, plan.md,
  plan.json, settings), tickets, runs (prompt, output, verdict, cost, tokens,
  session id), every streamed agent event, and the conversation. Survives
  restarts; queued runs resume, runs that were mid-flight are marked interrupted.
- **`~/.software-factory/initiatives/<slug>/`**: the files agents read and write
  (`brief.md`, `plan/round-N/plan.md|plan.json|plan-review.md`,
  `tickets/<nn>-<key>/ticket.md`, `round-N/build.md|checks.md|review.md|fix.md`).
- **`~/.software-factory/worktrees/`**: one git worktree per ticket, removed
  once the ticket is merged. Your own checkout is never modified.
- **`agents/*.md`**: the role instructions for planner, plan reviewer, executor,
  reviewer, fixer, mechanical fixer, fix verifier and advisor, plus the shared
  `repo-rules.md` (every agent) and `code-style.md` (agents that write or
  judge code). Edit them to change how the factory thinks.

## Guardrails

- Agents never push, merge, rebase shared history or talk to GitHub. The server
  pushes only `factory/*` branches, never force-pushes, and never merges: you merge.
- Agents only add commits. The server notes HEAD before every build and fix;
  if an agent rewrote a commit it didn't make (say, `--amend` after a
  pre-commit hook cancelled its commit), its changes go back on top as a new
  commit before the checks run or anything is pushed.
- Agents start clean: no MCP servers and (by default) no user-level hooks or
  plugins, so nothing pollutes their context. The repo's own CLAUDE.md,
  `.claude/rules`, skills and `.claude/` settings still apply (see below).
- Text from GitHub reaches agents only as quoted data in a file, and the
  factory's own PR comments are marked so they never loop back. Every
  comment and thread reply the factory posts starts with
  **Claude Bot Automation**. A review
  thread whose last word is yours or the factory's waits for its reviewer and
  isn't fed to a fixer again; failing CI waits until every check has finished;
  status bots (GitHub Actions, Meticulous) and human-gated checks (Code review
  gate, Meticulous) are ignored.
- Nothing a fixer did reaches the PR before the checks pass and a verifier
  approves it. Fix rounds count toward the round limit, including retries
  after a block, so a fix that keeps breaking stops and waits for you.
- plan.json is validated (schema, bullet lengths, sizes, dependency DAG) before
  any ticket exists; an invalid plan goes back to a fresh planner with the errors.
- The checks command comes from the project settings in the DB, so a branch can't
  change the checks it is judged by. Checks failures never reach a reviewer.
- No secrets: Postgres listens on loopback only with trust auth, so there is no
  password to store. Agents use your existing `claude` login.
- PRs are opened as drafts and the factory never marks them ready; that is
  always your call. Each has a short imperative title that states the outcome and a
  description written by the executor: a one-line **What**, a short **Why**
  with the context, and a 2-4 bullet high-level **Overview**. No headings,
  checklists, file lists or ticket numbers; if the executor's text breaks those
  rules the ticket's own what and goal are used instead.
  Dependent tickets open stacked PRs.
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

`pnpm dev` runs the server without file watching on purpose: a restart stops
every running agent (they are marked interrupted and can be re-run). When you
are changing the factory itself, use `pnpm --filter @factory/server dev:watch`.

```bash
pnpm typecheck
pnpm test           # plan validation + DAG ordering
pnpm db:psql        # poke at the data
pnpm db:reset       # wipe the database volume
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
