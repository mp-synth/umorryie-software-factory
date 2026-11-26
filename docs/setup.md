# Setup

## Before you start

The factory is developed on macOS. Keeping it running in the background
(`pnpm service`) works only on macOS.

| You need | Why | Check that it works |
|---|---|---|
| Node 20.12 or newer | Runs the server and the UI | `node -v` |
| pnpm 9 | Installs dependencies and runs the scripts | `pnpm -v` |
| Docker Desktop, running | Hosts the Postgres database | `docker info` |
| git | Branches and worktrees | `git --version` |
| Claude Code CLI, logged in | Every agent is a `claude` process | `claude -p "say ok"` prints ok |
| GitHub CLI `gh`, logged in | PRs, CI results and review comments | `gh auth status` |

Two things people miss:

- **Your Claude account must be able to use the agents' models**: Opus 5.5 for
  most steps and Fable 5.2 for the arbiter. You can change the model per step in
  an initiative's **Autopilot** card.
- **`git push` must work without a password prompt** from your clone of each
  project (an SSH key, or `gh auth setup-git`). Without `gh` and push access,
  the factory still builds and reviews, but the branches stay local and no PRs
  are opened.

On a fresh Mac with [Homebrew](https://brew.sh):

```bash
brew install node git gh
brew install --cask docker   # then open Docker Desktop once and wait until it says it is running
npm install -g pnpm@9
curl -fsSL https://claude.ai/install.sh | bash
claude                       # log in in the browser, then type /exit
gh auth login                # GitHub.com, HTTPS, log in with a browser
gh auth setup-git            # lets git push with the same login
```

## Install and run

1. Get the code.

   ```bash
   git clone https://github.com/mp-synth/umorryie-software-factory.git software-factory
   cd software-factory
   ```

2. Install. This checks the tools, installs dependencies and starts Postgres in
   Docker. A warning about `claude` or `gh` means that tool is missing or not on
   your `PATH`; fix it before going on.

   ```bash
   pnpm bootstrap
   ```

3. Start it, then open **http://localhost:5173**.

   ```bash
   pnpm dev
   ```

The factory runs as long as that terminal does. **Ctrl-C** stops the server,
but agents that are already running keep going and the next start picks them
up. **Ctrl-\\** stops the server and every running agent. To keep it running
without a terminal, see [Keep it running on a Mac](#keep-it-running-on-a-mac).

You don't need a `.env` file. Copy `.env.example` to `.env` only to move the
data folder, the database port or the path to `claude`.

`pnpm start` is the alternative to `pnpm dev`: it builds the UI once and serves
everything from **http://localhost:4317**, without hot reload.

## Your first initiative

1. **Projects → Add project.** Pick the repo in the folder browser (or paste its
   path) and choose the base branch, usually `main`.
2. **Check what discovery found.** A first guess comes from lockfiles and
   package scripts at once; then a read-only agent (Sonnet, about 20 seconds
   and $0.10) reads the repo's `CLAUDE.md`, `AGENTS.md`, CI config and scripts,
   and proposes:
   - the **setup command**, run once in every new worktree (for example `pnpm install`);
   - the **checks command**: formatting, lint, type checks and the relevant tests
     scoped to what the branch changed (`$FACTORY_BASE`), before the PR's wider CI;
   - the gitignored **files to copy into each worktree**, such as `.env`;
   - **reference folders**: other local checkouts agents may read (an SDK and the service it calls);
   - what must be **running for the checks** (a database, a registry login).

   Read these before you save. Every field stays editable, and **Re-run** in the
   edit dialog proposes fresh commands. A wrong checks command is the most
   common reason tickets end up in **Needs you**.
3. **New initiative.** Write the brief: the outcome you want and how you will
   know it is done, not how to build it. Paste any links that matter (GitHub
   PRs, files or issues, Notion pages, docs); every agent gets a local copy (see
   [Links to other repos, PRs and docs](links.md)).
4. **Watch it work.** The dashboard shows what is waiting on you, and the live
   panel streams every agent of the initiative. With the arbiter on (the
   default), the factory only stops for things only you can decide.
5. **Review the draft PRs.** They stay drafts until you mark them ready. To
   change something across the PRs, write it once in **Feedback** with
   **Whole initiative** selected (see [Steering](steering.md)).

A 4-ticket feature costs about $2.50 of agent time. The **Usage** page shows
what the agents spent. The factory runs many agents at once (up to four per CPU
core); if your Claude plan's rate limits run out first, set a smaller fixed
number in **Settings**.

To try a project's environment without running an initiative:

```bash
pnpm --filter @factory/server probe EnactServices --diff-from origin/master~1 --prompt "Call the Lago API with the key from .env and find the endpoint in lago-api"
```

It makes a throwaway worktree, copies the files, runs setup and checks (diffed
against `--diff-from`), then starts an agent exactly as the factory would.

## Keep it running on a Mac

`pnpm dev` and `pnpm start` stop with the terminal (or Claude session) that
started them. To keep the factory running, install it as launchd jobs instead,
from the main checkout on `main`:

```bash
pnpm service install   # API on :4317, UI on :5173 and the watch, now and at every login
```

They come back after a crash or a reboot and belong to no terminal or session.
Server changes never go live on their own: `pnpm service promote` typechecks the
checkout, runs the server tests and only then restarts the server, and running
agents keep going. It refuses while the checkout is off `main`, in the middle
of a merge or rebase, or waiting for `pnpm install` after a lockfile change.
The watch only logs, once per set of changes, that the server runs older code.
The UI hot-reloads and `agents/*.md` are read at every spawn, so neither needs
a restart.

`pnpm service restart` restarts without the checks (`restart all` restarts the UI too),
`pnpm service status` says whether the server is running older code than the
checkout, `pnpm service logs [web|watch]` follows the logs in
`~/.software-factory/logs` (rotated at 10 MB), and `pnpm service stop`,
`start` and `uninstall` do what they say. Run `install` again after you change
your Node version or PATH.

## When something goes wrong

| What you see | What to do |
|---|---|
| `docker is required`, or `pnpm bootstrap` hangs on the database | Open Docker Desktop, wait until it is running, run the command again |
| `warning: claude CLI not found` | Install it (see [Before you start](#before-you-start)), or put its full path in `.env` as `CLAUDE_BIN=` |
| `Another factory server is already running on this database` | A factory is already running, in another terminal or as `pnpm service`. Use that one, or stop it first |
| Port 4317 or 5173 already in use | Find what holds it with `lsof -i :4317` and stop it |
| Every agent fails at once | Run `claude -p "say ok"`. If that fails, log in again. If it is about the model, pick another one in the initiative's **Autopilot** card |
| Tickets get built but no PR opens | `gh auth status`, and check that `git push` works from your clone without a prompt |
| A ticket says the checks command could not run | Fix the checks command in the project's edit dialog, then press **Fix** or re-run the checks |
| A Notion link is listed as not fetched | `claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp`, then `claude mcp login notion` |
| You want a clean start | `pnpm db:reset` wipes the database: every project, initiative and run |

