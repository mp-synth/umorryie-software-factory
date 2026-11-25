# Software Factory

Software Factory turns a short description of a feature into reviewed draft pull
requests. You write what you want; Claude Code agents plan it, build it in small
tickets, review it and fix what the review finds. You read the draft PRs and
decide what merges.

It runs on your own computer and uses your own `claude`, git and `gh` logins.
It is a one-person tool with no login screen: everyone runs their own copy.

## How it works

1. **Add a project**: a git repo you already have cloned.
2. **Start an initiative**: write a brief, a few sentences on the outcome you want.
3. **Plan**: an agent writes a plan split into small tickets, and another reviews it.
4. **Approve**: you approve the plan, or the arbiter (a fresh agent) does it for you.
5. **Build**: per ticket, an agent writes the code in its own git worktree, checks
   run, a reviewer judges it, and a fixer handles what the review, CI or PR
   comments find.
6. **Review**: each ticket becomes a draft PR. You read and merge.

Every step is a separate `claude -p` process with an empty context. The server,
not an agent, owns state, git, pushes and PRs.

## Quick start

You need Node 20.12+, pnpm 9, Docker Desktop (running), git, and the `claude`
and `gh` CLIs, both logged in. [Setup](docs/setup.md) has install commands and
the checks for each.

```bash
git clone https://github.com/mp-synth/umorryie-software-factory.git software-factory
cd software-factory
pnpm bootstrap   # checks tools, installs deps, starts Postgres in Docker
pnpm dev         # open http://localhost:5173
```

Then **Projects → Add project**, check the setup and checks commands it proposes,
and start a **New initiative** with a brief.

## Safety

- Agents run without permission prompts, as you, inside their own worktrees. They
  cannot push or post on GitHub; only the server pushes, only `factory/*`
  branches, never with force.
- The server listens on `127.0.0.1` and has no login. Never expose it to the
  network: anyone who reaches it can run agents on your machine with your
  credentials.

## Docs

| Doc | Read it when |
|---|---|
| [Setup](docs/setup.md) | Installing, adding your first project, running it in the background, troubleshooting |
| [How the pipeline works](docs/pipeline.md) | You want to know what each ticket status means, how stacked PRs work and when the arbiter decides |
| [Steering](docs/steering.md) | You want changes across the PRs, or want the factory to learn from your feedback |
| [Links](docs/links.md) | You paste GitHub, Notion or other URLs into a brief |
| [The UI](docs/ui.md) | You are looking for a button or how spend is counted |
| [Large repos](docs/large-repos.md) | The project is a monorepo, needs secrets or local services |
| [Guardrails](docs/guardrails.md) | You want to know what agents can and cannot do |
| [Where things live](docs/where-things-live.md) | You look for files, the database or how restarts are survived |
| [Development](docs/development.md) | You change the factory itself, or evaluate the reviewer and verifier prompts |
