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

Then: **Projects → Add project** (any local git repo; it suggests a checks
command), **New initiative**, write a brief, and watch the planner work.

What a run looks like (the demo in `~/.software-factory/demo/todo-app`): a
4-ticket feature ("priorities and due dates" for a todo CLI) went plan → plan
review → approval → 4 builds (two in parallel, stacked) → checks → 4 reviews,
including one fresh executor resolving a merge conflict between two sibling
tickets and one fix round from owner feedback, for about $2.50 of agent time.
On a GitHub repo the same flow opens stacked draft PRs, posts each review on
its PR, marks PRs ready on APPROVE, and **Fix all PRs** turns unresolved review
threads into a fix round (the factory's own comments are ignored).

## What you can do in the UI

| Where | What |
|---|---|
| Dashboard | Every initiative with segmented progress, what is waiting on you, agents running now, total spend |
| Initiative → Plan | High-level overview first (goal, summary, success criteria, definition of done), then edge cases, test strategy, risks, assumptions, the plan review and the full plan.md on demand. **Approve & build** or **Request changes** (your words go to a fresh planner as binding feedback). Answer the planner's questions when it is blocked |
| Initiative → Tickets | One row per ticket: status, verdict, PR, cost. Expand for what/goal/outcome, acceptance checks, guidance, branch/worktree, every agent run, and the latest output. **Run / Review / Fix** per ticket; **Run ready / Review all / Fix all PRs / Sync PRs** in bulk; edit a ticket before it starts; reset a ticket; mark approved/merged |
| Initiative → Activity | The conversation with the agents. **Ask** starts a read-only advisor that answers from the code; **Feedback** re-plans (before approval) or goes to a fresh fixer (per ticket); **Note** just records |
| Initiative → Autopilot | Which steps run by themselves: plan review, build after approval, review after build, auto-fix, push & open draft PRs, post reviews on PRs; round limits, parallelism and the model per step |
| Run drawer | Live stream of any agent: tool calls with inputs and results, text, thinking, the checks log, cost/tokens/turns. Its output file, the exact prompt header, and a `claude --resume` command to continue that session in your terminal. **Stop** kills it |
| Agents | Every run across all initiatives, live |

## How a ticket moves

| Status | Meaning |
|---|---|
| proposed | In a plan you haven't approved |
| to do | Approved; starts when its dependencies are approved (or press Run) |
| building | Executor is working in `~/.software-factory/worktrees/...` on `factory/<initiative>/<nn>-<key>` |
| running checks | The project's checks command runs in the worktree. Red → fixer. Green → push + draft PR. If the command can't run at all (exit 126/127) the ticket goes to *needs you* instead of burning a fixer round. **Run checks** re-runs it by hand |
| built | Checked and waiting for review (when auto-review is off) |
| in review | A fresh reviewer reads `git diff <base>...HEAD`, verifies each finding, answers APPROVE or CHANGES |
| changes requested | Waiting for a fixer (auto-fix runs it unless the round limit is reached) |
| fixing | A fixer gives every item a verdict before touching code (VALID / PARTIAL / INVALID / UNCONFIRMED / NEEDS-HUMAN): a bug is fixed only after it is traced and gets a test that fails without the fix; a claim is rejected only by pointing at the code. Rounds with only failing checks, CI or conflicts get a cheaper mechanical fixer that first checks whether the base branch fails the same way and lists flaky runs for one re-run. Fixes are committed locally; after the checks pass, a fresh **verifier** reads the commits and drafted replies. Approved: the factory pushes, replies in each review thread, answers top-level comments in one summary, and resolves only bot threads. Blocked: the branch is reset and a fresh fixer retries once with the findings; a second block pushes nothing and waits for you. When a PR has nothing to act on, no agent is started |
| approved | Reviewer would merge it. PR marked ready. Dependents start |
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
- Agents start clean: no MCP servers and (by default) no user-level hooks or
  plugins, so nothing pollutes their context. The repo's own CLAUDE.md,
  `.claude/rules`, skills and `.claude/` settings still apply (see below).
- Text from GitHub reaches agents only as quoted data in a file, and the
  factory's own PR comments are marked so they never loop back. A review
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
- PRs are drafts with a short imperative title that states the outcome and a
  2-4 sentence description of what changes and why, written by the executor.
  No headings, checklists, file lists or ticket numbers; if the executor's text
  breaks those rules the ticket's own plain-language summary is used instead.
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
- **Worktrees.** Ignored files the repo's `.worktreeinclude` names (`.env` and
  the like, gitignore syntax) are copied into every new worktree, then the
  setup command runs there once. If setup fails, the ticket waits for you
  instead of burning an agent run, and setup runs again on the next attempt.
- **Checks on what changed.** The checks command, the setup command and the
  agents get `$FACTORY_BASE` (the ref the branch is diffed against) and
  `$FACTORY_BRANCH`, so the gate can check only what the branch touched, for
  example `uv run prek run --from-ref "$FACTORY_BASE" --to-ref HEAD && uv run pytest --affected -q`
  in EnactServices.

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
