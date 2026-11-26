alter table projects
  add column if not exists fix_command text,
  add column if not exists merge_check_command text,
  add column if not exists quick_checks_command text,
  add column if not exists check_policy jsonb not null default '[]',
  add column if not exists generated_paths jsonb not null default '[]',
  add column if not exists skip_agent_commit_hooks boolean not null default false;

-- Skipping hooks is opt-in: a later gate cannot purge a secret from an earlier commit's history.

alter table tickets
  add column if not exists foundation boolean not null default false,
  add column if not exists touches jsonb not null default '[]';

alter table runs
  add column if not exists tree_sha text,
  add column if not exists checks_digest text,
  add column if not exists gate_purpose text,
  add column if not exists gate_resting_status text;

create index if not exists runs_gate_tree on runs (tree_sha, checks_digest) where kind = 'gate' and tree_sha is not null;

-- What the factory remembers between restarts so it never repeats a decision: which conflict a fixer already had,
-- which red CI run was handed over, which merge-queue attempts were made.
create table if not exists factory_memory (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- CI outcome per pushed head, so a gate that passed where CI then failed (a gate escape) can be counted.
create table if not exists ci_results (
  ticket_id uuid not null references tickets(id) on delete cascade,
  head_sha text not null,
  state text not null,
  failing jsonb not null default '[]',
  recorded_at timestamptz not null default now(),
  primary key (ticket_id, head_sha)
);
