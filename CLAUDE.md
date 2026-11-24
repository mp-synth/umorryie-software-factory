# Working on software-factory

## The live factory

The factory that runs real initiatives runs from this checkout on `main`, as two
launchd jobs installed with `pnpm service install`: the API on :4317 and the UI
on :5173. They do not belong to any Claude session.

- Never start the live server or UI yourself (`preview_start`, `pnpm dev`,
  `tsx src/index.ts`). The desktop app stops a session's preview servers 30
  minutes after the session goes idle, which takes the factory down, and a second
  server on the same database exits because it cannot take the lock.
- A watch job restarts the live server onto this checkout 20 s after the last
  change to server files, once the server typechecks (running agents keep
  going). Every edit here goes live, so make engine changes that take several
  steps in a git worktree and bring them to `main` when they are done. Do not
  restart by hand unless the owner asks; `pnpm service status` says whether the
  server runs older code than the checkout, and `pnpm service logs watch` says
  why the watch did not restart. The UI hot-reloads and `agents/*.md` are read
  at every agent spawn, so neither needs a restart.
- To look at UI changes in the Browser pane, preview `factory-web-check` (vite
  on :5174 against the live API). It writes to the real database, so stub
  `fetch` for anything that posts.
- To run engine changes end to end, start a throwaway server with its own
  `PORT`, `DATABASE_URL` and `FACTORY_HOME`. Never write to the default
  `factory` database from a test or script.
