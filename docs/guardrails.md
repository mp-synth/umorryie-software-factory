# Guardrails

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
  apply (see [Large repos](large-repos.md)).
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
  change the command it is judged by. An absolute path in a checks or fix command
  still reads that script from the referenced checkout: editing it takes effect
  immediately for later gates, without changing the project setting or ticket
  branch. Checks failures never reach a reviewer.
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
- `agents/code-style.md` holds the owner's code rules (no duplication, comments
  only for reasons that code cannot express, no change-comments, no redundant
  docstrings). The executor, fixer and reviewer get it with every prompt, and
  the reviewer treats violations as major findings.

