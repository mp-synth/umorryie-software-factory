-- One row per agent session, priced from its transcript. Runs can be deleted (a reset or a
-- deleted initiative cascades to them) or overwritten (a retried step); this ledger keeps the
-- money every session actually spent.
create table agent_usage (
  session_id         text primary key,
  run_id             uuid references runs(id) on delete set null,
  initiative_id      uuid references initiatives(id) on delete set null,
  kind               text not null,
  label              text,
  model              text,
  effort             text,
  cwd                text,
  started_at         timestamptz not null,
  finished_at        timestamptz,
  requests           integer not null default 0,
  input_tokens       bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cache_read_tokens  bigint not null default 0,
  output_tokens      bigint not null default 0,
  cost_usd           double precision not null default 0,
  reported_cost_usd  double precision,
  priced_from        text not null default 'transcript'
);

create index agent_usage_started_at on agent_usage (started_at);
create index agent_usage_initiative on agent_usage (initiative_id);
create index agent_usage_run on agent_usage (run_id);
