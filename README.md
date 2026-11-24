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

Both stop with the terminal (or Claude session) that started them. To keep
the factory running on a Mac, install it as launchd jobs instead, from
the main checkout on `main`:

```bash
pnpm service install   # API on :4317, UI on :5173 and the watch, now and at every login
```

They come back after a crash or a reboot and belong to no terminal or session.
The watch keeps the server on the checkout's code: 20 seconds after the last
change to the server's files it typechecks the server and restarts it, and
running agents keep going. It does not restart while the checkout is off
`main`, in the middle of a merge or rebase, or waiting for `pnpm install`
after a lockfile change. A change that does not typecheck is logged once and
retried when the files change again. The UI hot-reloads and `agents/*.md` are
read at every spawn, so neither needs a restart.

`pnpm service restart` restarts by hand (`restart all` restarts the UI too),
`pnpm service status` says whether the server is running older code than the
checkout, `pnpm service logs [web|watch]` follows the logs in
`~/.software-factory/logs` (rotated at 10 MB), and `pnpm service stop`,
`start` and `uninstall` do what they say. Run `install` again after you change
your Node version or PATH.

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
its PR, leaves every PR in draft for you to mark ready (one by one on GitHub, or all at once with
**More → Make PRs non-draft**), and **Fix all PRs** turns unresolved review
threads into a fix round. Every comment counts, yours included, unless the factory wrote it (its
comments carry a hidden marker), its thread is resolved, or the last fix already saw it. A reply on
an outdated thread counts too; the fixer is told the lines it was left on have changed. It skips every ticket with nothing
left to act on: no new review findings, failing checks or CI, conflicts, unanswered comments or feedback.

What lands on a PR is written for its reviewer, not for agents. A review is one
line (`Review round 2: CHANGES · checks passed · acceptance 3/4 met`) and one
numbered item per finding: severity, `path:line`, the claim, the failure
scenario and the suggested fix. The reviewer's evidence, summary, acceptance
table, notes and earlier-round bookkeeping stay in the factory. A verified fix
round posts `Fix round N`, its commits and one line per answered top-level
comment; thread replies are one or two sentences that end in a commit sha or a
`path:line`. Every agent whose text reaches people follows `agents/writing.md`.

## Links to other repos, PRs and docs

Paste any URL into a brief, a feedback or a note and every agent of that
initiative gets it as a local, read-only copy, so an EnactServices initiative
can say "implement the backend for https://github.com/Synthesia-Technologies/TTVPlatform/pull/34521"
and the planner, executors and reviewers all read the same PR. Before each agent
starts, the server resolves every link it finds in the brief, the project notes
and your own messages:

| Link | What the agent gets |
| --- | --- |
| GitHub PR in any repo | A checkout at the PR head, plus `pr.md` (title, description, changed files) and `pr.diff`. Rechecked every 10 minutes, so a PR that moves gets a new checkout |
| GitHub file or folder (`/blob/…`, `/tree/…`, with `#L10-L20`) | A checkout at that branch, tag or sha, and the path and lines to read. Rechecked every hour when it's on a branch |
| GitHub commit, issue or repo (also open-source ones) | A checkout at the commit or the default branch; for an issue, its text and comments. A repo or issue is rechecked every hour; a commit stays as it is |
| Notion page (`notion.so`, `app.notion.com`, `*.notion.site`) | The page as text, read with your own Notion login. Rechecked every hour |
| Anything else (docs, articles, a gist) | The page as text |
| The project's own repo | Just the path; the agent already works in it |

Everything is listed in `links.md` in the initiative folder, which each agent's
prompt points to; the agents read it, plan and build in the project's repo only,
and never edit the checkouts. Each linked GitHub repo has one bare mirror in
`~/.software-factory/link-mirrors/` that borrows objects from a clone of the same
repo next to the project (`~/workspace/TTVPlatform`) when there is one, so a
TTVPlatform PR is ready in seconds and the mirror stays small. The factory never
writes to your clone, but the mirror depends on it: if the clone moves or
garbage-collects objects the mirror borrowed, the mirror notices before it hands
out a checkout and rebuilds itself with its own copy of everything. Without a
clone, the commit is fetched shallow (two commits deep for a commit link, so its
diff is right), which needs `git` access to the repo (public repos need nothing).
PR and issue text comes from `gh`. At most 15 links are fetched: the brief's and
the notes' first, then those in your newest messages; the rest are listed in
`links.md` as not fetched. A link that can't be fetched (a private page) is
listed with the reason and the agent tries `gh` or WebFetch itself, or
says it couldn't read it. Fetched text is marked as untrusted, and agents never
follow instructions found in it. Checkouts are removed with the initiative (on
reset and delete), and a PR's old checkout is removed when its head moves.

A Notion page is read through Notion's hosted MCP server with the Notion login the
`claude` CLI already holds: a one-shot Haiku session that may call only
`notion-fetch`, and the page file is that tool's result, never the model's reply.
It costs about two cents a page and shows on the usage page as "Notion pages",
booked to the initiative. Without a Notion login the link is listed with the fix:
run `claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp`
and then `claude mcp login notion`. Only the linked page is read, not the pages it
links to; paste those too when they matter.

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
adopting from that repo. The sweep also comes sooner when it matters: the
factory checks every minute whether the base branch of an open PR moved on
GitHub (a merge does that, and that is when other PRs start to conflict), and
sweeps that repo's PRs a minute later. While GitHub has not worked out yet
whether a PR still merges, the sweep asks again after 45 seconds, up to three
times. For each PR, a merge conflict, failing CI that has finished (tests,
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
| Dashboard | Every initiative with segmented progress, what is waiting on you, agents running now, and agent spend this week (since Monday 00:00 UTC), which opens Usage |
| Initiative → Plan | High-level overview first (goal, summary, success criteria, definition of done), then edge cases, test strategy, risks, assumptions, the plan review and the full plan.md on demand. Paths the plan names that do not exist at the base are listed for the plan reviewer (never a rejection). **Approve & build** or **Request changes** (your words go to a fresh planner as binding feedback). Answer the planner's questions when it is blocked |
| Initiative → Tickets | One row per ticket: status, verdict, PR, cost. Expand for what/goal/outcome, acceptance checks, guidance, branch/worktree, every agent run, and the latest output. **Run / Review / Fix** per ticket; **Run ready / Review all / Fix all PRs / Sync PRs** in bulk; edit a ticket before it starts; reset a ticket; mark approved/merged. The row shows the lines the ticket changed outside tests, lockfiles and files the repo marks `linguist-generated`, flagged when over 1.5 times its size budget (XS 50, S 200, M 500) |
| Initiative → Activity | The conversation with the agents. **Ask** starts a read-only advisor that answers from the code; **Feedback** re-plans (before approval), goes to a fresh fixer (per ticket) or, for the whole initiative after approval, to a steering router that splits it across the PRs; **Note** just records |
| Initiative → Learned rules | Rules a retro proposed from your steering: **Accept**, **Edit** or **Reject**, and the rules active in the project with **Retire** |
| Initiative → Autopilot | Which steps run by themselves: plan review, build after approval, review after build, auto-fix, push & open draft PRs, post reviews on PRs, hold dependents until CI is green, the arbiter deciding for you, a retro once a steered PR merges or queues; round limits, arbiter decisions in a row, parallelism and the model per step (Fable 5.2, Opus 5.5, Sonnet 5.5 or Haiku 5.5, each pinned to that version and run with the 1M context window) |
| Sidebar | The theme switcher (system, light or dark) sits next to the live indicator |
| Live panel | On an initiative page, every agent of the initiative as one log in order, newest at the bottom: running agents stream live, finished ones fold to their header. Collapse it to a rail that still shows who is running, or drag its edge to resize it. Open any run for its details: tool calls with inputs and results, text, thinking, the checks log, cost/tokens/turns, its output file, the exact prompt header, and a `claude --resume` command to continue that session in your terminal. **Stop** kills it. On other pages it appears only for a run you open |
| Agents | Every run across all initiatives, live |
| Usage | What the agents spent, week by week (Monday 00:00 UTC): the total with its token split (cache writes, cache reads, output, uncached input), spend per day (click a day for its sessions), per step and per model, every agent session with a link to its run, and the history of earlier weeks |

Spend comes from a usage ledger (`agent_usage`), one row per agent session. Each row is priced from the session's own transcript (`~/.claude/projects/<cwd>/<session>.jsonl`), so every API response counts at Claude API list prices, cache writes and reads separately. Agents that failed, timed out or were stopped count too, as do discovery agents and the sessions of initiatives that were reset or deleted, whose runs are gone. A session is recorded when its agent ends; at startup the server also reads any transcripts it has not recorded yet, so the history goes back as far as Claude Code keeps transcripts (30 days by default). A session whose transcript is already gone keeps the cost the CLI reported. Your own interactive Claude Code sessions are not factory spend and are left out, even though an organization's usage dashboard counts them.

## How a ticket moves

| Status | Meaning |
|---|---|
| proposed | In a plan you haven't approved |
| to do | Approved; starts when its dependencies are approved (or press Run) |
| building | Executor is working in `~/.software-factory/worktrees/...` on `factory/<initiative>-<id>/<nn>-<key>` |
| running checks | The project's checks command runs in the worktree. Red → fixer, which gets the failing lines and the path of the full log. Green → push + draft PR. If the command can't run at all (exit 126/127) the ticket goes to *needs you* instead of burning a fixer round. **Run checks** re-runs it by hand |
| built | Checked and waiting for review (when auto-review is off) |
| in review | A fresh reviewer reads `git diff <base>...HEAD` and the initiative's goal, success criteria and definition of done, verifies each finding, answers APPROVE or CHANGES. Code that only tests use (the PR's own, or code it leaves without a production caller) is a finding to delete it with its tests. An over-budget ticket carries a Size note in the review header |
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

## After the PRs: steer once, then teach the factory

When you read the PRs and want something changed, write it once in the
initiative's **Feedback** with **Whole initiative** selected and press **Send
to the PRs**. This works while the initiative builds and after it is done. A
fresh, read-only steering router (Opus) reads your words, the brief, the plan
and every ticket's diff, and sends each change to the ticket whose diff adds
that code. When several stacked tickets touch it, the change goes to the lowest
open one, because the stack carries it up. Each of those tickets gets the
router's numbered instructions with your words quoted as binding feedback, and
a fresh fixer runs them through checks, the verifier and a push as usual.
Merged or canceled tickets can't take changes: the router says which part went
nowhere and needs a follow-up initiative. Before the plan is approved, the same
box still re-plans.

When your words change the plan rather than code inside a ticket (another
approach or architecture, a changed API or contract, scope added or dropped),
the router re-plans instead. A fresh planner revises the plan with your words
and `tickets.md`, the built tickets with their PRs and diffs. Steps already
running finish, but no new ticket starts. The revised plan goes through plan
review and approval as usual. Then:

- tickets whose text is unchanged keep building;
- tickets whose text changed are rebuilt from their base on a new PR, and so is
  every ticket stacked on them, with the old PR closed;
- tickets the plan drops are canceled, with their PRs closed;
- new tickets start.

Merged tickets stay as they are.

Feedback that arrives while a ticket is busy (building, in review, being fixed)
is not left behind: once the ticket's last step ends, a fixer picks it up.

Every time you had to steer, the factory missed something. With **Retro once a
steered PR merges or queues** on (the default, in Autopilot), a ticket whose PR
merges or enters the merge queue gets a retro: a fresh Opus agent that never
saw the work. It only runs when you steered that ticket: your feedback or notes,
sending work back, approving or overruling a step by hand, routed feedback, or
review comments people left on the PR (bot findings don't count). It reads:

- a timeline of every step with what you said in between, in bold;
- the people's PR comments the fixer got;
- the brief, the plan and the ticket;
- each step's output, the diff and the repo's own rules;
- the rules learned so far.

For each steering item it writes what was wrong, which step should have caught
it first, and why that step didn't: a rule was missing, a rule exists and was
ignored, or the agent couldn't have known. Then it proposes at most three
durable rules, often none. A rule names its scope and the agent it is for:

- **this project**: kept in the database and added to the system prompt of
  every matching agent in this project, under "Rules learned in this project";
- **every project**: written into the role file (`agents/<role>.md`, or
  `repo-rules.md`, `code-style.md` or `writing.md`) under `## Learned rules`.
  That edits your factory checkout: commit it, or a `git checkout` or reset
  drops the rule while the database still lists it as active.

Once every PR of the initiative is merged or in the queue, and you steered the
plan or the whole initiative, one more retro looks at the plan. It runs after
the ticket retros and reads what they found. Retros never hold a ticket, and a
merge doesn't stop them. To run one yourself, use **Retro: learn from my
steering** in a ticket's menu or **More → Retro on the plan**.

Proposed rules wait in the initiative's **Learned rules** card. Nothing changes
until you act on one:

- **Accept** applies the rule from the next step on.
- **Edit** changes its text, scope or agent before you accept it.
- **Reject** drops it, and later retros see the rejection so they don't propose
  it again.
- **Retire**, on a rule that is already active, takes it out again; for an
  every-project rule it also removes the line from the role file.

The card also lists every rule active in the project.

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
  **Auto-merge PRs** on, or when you press **More → Make PRs non-draft**, which
  marks every open draft PR of the initiative ready at once; otherwise that is
  your call. Each has a short
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
`pnpm --filter @factory/server dev:watch` to restart on every save. With the
launchd jobs installed, the watch restarts the server for you once your changes
typecheck; `pnpm service restart` does the same by hand: it sends the server
SIGTERM (and a second one if it is still waiting after 30 seconds), and launchd
starts it again from the checkout.

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
