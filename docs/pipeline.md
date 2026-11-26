# How the pipeline works

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
then writes exactly one output file whose first line is its verdict. The server,
not an agent, owns state, git, pushes, PRs and sequencing. That keeps every
step small, reproducible and re-runnable on its own.

## Words you will see in the UI

| Word | Meaning |
|---|---|
| Project | A git repo on your machine that the factory works in |
| Initiative | One feature or change in a project, from brief to merged PRs |
| Brief | What you want, in your own words. Everything starts from it |
| Ticket | One small piece of the plan; becomes one branch and one draft PR |
| Worktree | A separate checkout per ticket under `~/.software-factory/worktrees`, so your own checkout is never touched |
| Arbiter | A fresh agent that decides for you when a step stops (approve, retry or ask you) |
| Needs you | A ticket or plan the factory cannot move on its own; the reason is on the row |

## How a ticket moves

| Status | Meaning |
|---|---|
| proposed | In a plan you haven't approved |
| to do | Approved; starts once the ticket it stacks on is built and its PR is open (with **Dependents start once the ticket below is built** off: once it is approved), or press Run |
| building | Executor is working in `~/.software-factory/worktrees/...` on `factory/<initiative>-<id>/<nn>-<key>` |
| running checks | The project's checks command runs in the worktree. Red → fixer, which gets the failing lines and the path of the full log. Green → push + draft PR. If the command can't run at all (exit 126/127) the ticket goes to *needs you* instead of burning a fixer round. **Run checks** re-runs it by hand |
| built | Checked and waiting for review: auto-review is off, or this is a stacked ticket whose first review waits until the ticket below is approved and its latest code is merged in (the activity feed says which) |
| in review | A fresh reviewer reads `git diff <base>...HEAD` and the initiative's goal, success criteria and definition of done, verifies each finding, answers APPROVE or CHANGES. Code that only tests use (the PR's own, or code it leaves without a production caller) is a finding to delete it with its tests. An over-budget ticket carries a Size note in the review header |
| changes requested | Waiting for a fixer (auto-fix runs it unless the round limit is reached) |
| fixing | A fixer gives every item a verdict before touching code (VALID / PARTIAL / INVALID / UNCONFIRMED / NEEDS-HUMAN): a bug is fixed only after it is traced and gets a test that would fail without the fix (written, not run: CI runs tests, and the fixer re-runs only the tests that failed in the PR's CI, before and after its fix); a claim is rejected only by pointing at the code. Rounds with only failing checks, CI or conflicts get a cheaper mechanical fixer that first checks whether the base branch fails the same way and lists flaky runs for one re-run. Fixes are committed locally; after the checks pass, a fresh **verifier** reads the commits and drafted replies. Approved: the factory pushes, updates the PR's title and description when the fixer rewrote them for the PR as it now stands (every fixer that commits starts from the current text and keeps what is still true; CI and lint fixes leave it alone), replies in each review thread, answers top-level comments in one summary, and resolves every thread it fixed once the fix is on the PR (bot threads it rejects with a code pointer too; a human's disputed or partly fixed thread stays open for them). Blocked: the branch is reset and a fresh fixer retries once with the findings; a second block pushes nothing and waits for you. When only rewriting pushed commits would fix the branch (someone else's commit in its history), the fixer answers REBUILD: the factory builds the ticket again from its base and puts the result on its existing PR as one new commit, so the PR keeps its number, stack place and discussion; it never opens a replacement PR or closes the old one. It stops for you instead when another ticket already builds on it or it was built 3 times. When a PR has nothing to act on, no agent is started |
| approved | The reviewer, or the arbiter over the reviewer's remaining findings, would merge it. The PR stays a draft until you mark it ready. Tickets stacked on it that waited for approval start, and held reviews above it start (with "Dependents wait for green CI" on, only once the PR's CI is green or has no checks; CI shows on the ticket row) |
| merged | Seen by Sync PRs (automatic every 5 min) or marked by you. Unblocks dependents. Its local worktree is removed, and its local branch too once no unmerged ticket is stacked on it |
| needs you | An agent reported BLOCKED, rounds ran out, or something failed. The reason is on the row. With the arbiter on, it decides first and the row shows **Arbiter deciding**; it stays **Needs you** only when the arbiter escalates or has used its decisions |

Dependent tickets are **stacked** as a tree. The planner's `depends_on` says
what each ticket needs; each ticket's branch starts from the one ticket it
needs and its PR targets that branch, so tickets that need the same ticket
build side by side on it. A branch has one base, so when a ticket needs two
tickets that don't build on each other, the later of the two (in plan order)
stacks on the earlier. Needs another need already brings are dropped. Tickets
that need nothing from the others branch from the base branch. The plan
reviewer gets `stacking.md` (what each ticket stacks on, the longest line,
the most tickets at once), and the plan's overview shows the longest line and
how many tickets can build at once.

A stacked ticket starts as soon as the ticket below is built and its PR is
open, from that PR's pushed head, so it is built while the one below is still
in review. Its first review waits until the ticket below is approved and its
latest code is merged in, so every review reads its ticket on top of the code
that merges under it. When the ticket below must be rebuilt from scratch, the
tickets above it that are not approved yet are reset and start again from its
new branch. Turn **Dependents start once the ticket below is built** off (in
Autopilot) to start them only once the ticket below is approved.

On GitHub the factory links stacked PRs into a native stacked PR as soon as the
PR opens, and Sync PRs links any it missed (your own PRs in Open PRs too, when
one targets another's branch). A GitHub stack is a single line, so when two
tickets stack on the same one, the first PR to open joins its stack and the
other stays a PR on that branch outside the stack; it syncs and retargets the
same way. A stacked ticket's row is marked **stacked**.

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

## What lands on GitHub

On a GitHub repo the factory opens stacked draft PRs, posts each review on its
PR, and leaves every PR in draft for you to mark ready (one by one on GitHub, or
all at once with **More → Make PRs non-draft**). **Fix all PRs** turns
unresolved review threads into a fix round. Every comment counts, yours
included, unless the factory wrote it (its comments carry a hidden marker), its
thread is resolved, or the last fix already saw it. A reply on an outdated
thread counts too; the fixer is told the lines it was left on have changed. It
skips every ticket with nothing left to act on: no new review findings, failing
checks or CI, conflicts, unanswered comments or feedback.

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
out, a stack merge that still conflicts after a fixer tried). An agent that prints
nothing for 20 minutes is stalled (no tool call runs that long) and is stopped
then, not at the end of its time limit. With **Arbiter decides for you** on (the default), each of these starts a
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
ticket on the same problem; after that it waits for you. A new row starts with
your next message there or to the whole initiative, when a reviewer or
verifier approves the ticket, and when the plan reviewer passes the plan, so a ticket that moved on and stops again on new
feedback still goes to the arbiter.
Anything you do on that plan or ticket stops a running arbiter, and a decision
that lands after you acted is not applied. While it decides, the ticket shows
**Arbiter deciding** instead of **Needs you**, and the dashboard doesn't count
it as waiting on you.

Every 15 minutes a PR sweep does the same on its own for every open factory PR
across all initiatives, and for every other open PR you opened in a
project's GitHub repo: one opened outside the factory, or one an archived or
deleted initiative left behind. Those are adopted into the project's **Open PRs**
initiative, and one closed and opened again goes back to its ticket there: the fixer works on a local `factory/pr-<n>` worktree that tracks
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
the same PR state (same head commit, checks, threads and comments). When it
leaves an open PR alone, the ticket row says why: nothing to fix, waiting for
CI, checking mergeability, a fixer already tried this exact state, or waiting
on people, naming the checks only people turn green (a code-owner review, a
Meticulous visual diff). The ticket's detail lists them, with what the sweep
ignored. Every PR has to end green and mergeable: when a fixer already had a
PR's exact failing CI or conflict and the PR is unchanged, the ticket stops
with the failing checks as its reason and goes to the arbiter, which sends a
new fixer the check's error and cause (or a rerun of a flaky job). Once the
ticket has used its rounds, it waits for you instead. Review threads and
comments a fixer already answered keep waiting for people. A GitHub Actions
job is started again when it is hung, once per run. One shown in progress
for an hour on a run that already finished only needs the job again. On a
run still going, the sweep waits out GitHub's default 6-hour job timeout,
then cancels the run (force-cancelling it after two minutes, which skips
`always()` steps and a lost runner) and re-runs its cancelled jobs. Turn it off
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

