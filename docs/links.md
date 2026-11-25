# Links to other repos, PRs and docs

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

