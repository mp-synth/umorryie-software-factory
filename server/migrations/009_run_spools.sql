create table if not exists run_spools (
  run_id        uuid primary key references runs(id) on delete cascade,
  dir           text not null,
  stdout_offset bigint not null default 0,
  stderr_offset bigint not null default 0,
  state         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
