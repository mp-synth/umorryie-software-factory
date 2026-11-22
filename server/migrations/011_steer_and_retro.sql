drop index if exists runs_one_active_agent_per_scope;
create unique index runs_one_active_agent_per_scope on runs (initiative_id, (coalesce(ticket_id, initiative_id)))
  where status in ('queued', 'running') and kind not in ('ask', 'retro');

create unique index runs_one_active_retro_per_scope on runs (initiative_id, (coalesce(ticket_id, initiative_id)))
  where status in ('queued', 'running') and kind = 'retro';

create table if not exists rules (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  initiative_id uuid references initiatives(id) on delete set null,
  ticket_id     uuid references tickets(id) on delete set null,
  run_id        uuid references runs(id) on delete set null,
  scope         text not null,
  role          text not null,
  body          text not null,
  why           text not null default '',
  status        text not null default 'proposed',
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index if not exists rules_project_idx on rules(project_id, status);
create index if not exists rules_initiative_idx on rules(initiative_id);
