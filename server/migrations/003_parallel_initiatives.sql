alter table tickets add column pr_sweep_claimed_at timestamptz;
alter table tickets add column pr_sweep_fingerprint text;

update runs r set status = 'canceled', finished_at = now(), error = 'another agent was already active for the same ticket'
where r.status in ('queued', 'running') and r.kind <> 'ask' and exists (
  select 1 from runs o
  where o.id <> r.id and o.status in ('queued', 'running') and o.kind <> 'ask'
    and o.initiative_id = r.initiative_id and o.ticket_id is not distinct from r.ticket_id
    and (o.queued_at, o.id) < (r.queued_at, r.id)
);

create unique index runs_one_active_agent_per_scope on runs (initiative_id, (coalesce(ticket_id, initiative_id)))
  where status in ('queued', 'running') and kind <> 'ask';

update app_settings set data = jsonb_set(data, '{maxConcurrentAgents}', '12')
where (data ->> 'maxConcurrentAgents')::int < 10;
