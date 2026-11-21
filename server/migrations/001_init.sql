-- Software factory schema. Every agent step is a row in `runs`; every line an
-- agent streams is a row in `run_events`, so any run can be replayed in the UI.

create extension if not exists pgcrypto;

create table projects (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  repo_path      text not null unique,
  default_branch text not null default 'main',
  checks_command text,
  setup_command  text,
  notes          text,
  remote_url     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table initiatives (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  slug         text not null,
  title        text not null,
  brief        text not null,
  base_branch  text not null,
  status       text not null default 'draft',
  plan_round   int not null default 0,
  plan_md      text,
  plan_json    jsonb,
  plan_verdict text,
  settings     jsonb not null default '{}'::jsonb,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index initiatives_project_idx on initiatives(project_id);

create table tickets (
  id             uuid primary key default gen_random_uuid(),
  initiative_id  uuid not null references initiatives(id) on delete cascade,
  key            text not null,
  seq            int not null,
  wave           int not null default 0,
  title          text not null,
  what           text not null default '',
  goal           text not null default '',
  outcome        text not null default '',
  guidance       jsonb not null default '[]'::jsonb,
  acceptance     jsonb not null default '[]'::jsonb,
  depends_on     jsonb not null default '[]'::jsonb,
  size           text,
  status         text not null default 'proposed',
  round          int not null default 0,
  branch         text,
  base_ref       text,
  worktree_path  text,
  pr_number      int,
  pr_url         text,
  pr_state       text,
  last_verdict   text,
  gate_status    text,
  blocked_reason text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (initiative_id, key)
);
create index tickets_initiative_idx on tickets(initiative_id, seq);

create table runs (
  id            uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references initiatives(id) on delete cascade,
  ticket_id     uuid references tickets(id) on delete cascade,
  kind          text not null,
  round         int not null default 0,
  status        text not null default 'queued',
  trigger       text not null default 'manual',
  model         text,
  effort        text,
  prompt        text,
  cwd           text,
  run_dir       text,
  output_path   text,
  output_md     text,
  verdict       text,
  summary       text,
  session_id    text,
  pid           int,
  cost_usd      double precision,
  input_tokens  int,
  output_tokens int,
  num_turns     int,
  error         text,
  queued_at     timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
create index runs_status_idx on runs(status, queued_at);
create index runs_initiative_idx on runs(initiative_id, queued_at desc);
create index runs_ticket_idx on runs(ticket_id, queued_at desc);

create table run_events (
  id     bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  ts     timestamptz not null default now(),
  type   text not null,
  data   jsonb not null default '{}'::jsonb
);
create index run_events_run_idx on run_events(run_id, id);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  initiative_id   uuid not null references initiatives(id) on delete cascade,
  ticket_id       uuid references tickets(id) on delete cascade,
  run_id          uuid references runs(id) on delete set null,
  author          text not null,
  kind            text not null default 'comment',
  body            text not null,
  consumed_by_run uuid references runs(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index messages_initiative_idx on messages(initiative_id, created_at);

create table app_settings (
  id         int primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into app_settings (id) values (1);
