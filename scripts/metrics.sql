begin transaction read only;

\echo
\echo '== Runs by kind and verdict =='
select kind, coalesce(verdict, status) as verdict, count(*) as runs,
  round(sum(cost_usd)::numeric, 2) as cost_usd,
  round((sum(extract(epoch from (finished_at - started_at))) / 60)::numeric, 1) as minutes
from runs
group by kind, coalesce(verdict, status)
order by kind, runs desc;

\echo
\echo '== First-pass review approval =='
with first_review as (
  select distinct on (ticket_id) ticket_id, verdict
  from runs
  where kind = 'review' and status = 'succeeded' and ticket_id is not null
  order by ticket_id, queued_at
)
select count(*) as tickets,
  count(*) filter (where verdict like 'VERDICT: APPROVE%') as approved,
  round(100.0 * count(*) filter (where verdict like 'VERDICT: APPROVE%') / nullif(count(*), 0), 1) as approval_pct
from first_review;

\echo
\echo '== Fix verdict mix =='
select coalesce(verdict, status) as fix_verdict, count(*) as runs,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct,
  round(sum(cost_usd)::numeric, 2) as cost_usd
from runs
where kind = 'fix'
group by coalesce(verdict, status)
order by runs desc;

\echo
\echo '== Fix rounds that changed nothing, with the verify and review runs that followed them =='
with no_op as (
  select r.id, r.ticket_id, r.queued_at, r.cost_usd,
    (select min(f.queued_at) from runs f where f.ticket_id = r.ticket_id and f.kind = 'fix' and f.queued_at > r.queued_at) as next_fix_at
  from runs r
  where r.kind = 'fix' and r.verdict ~* '^FIX:\s*(NO-CHANGES|NOTHING-TO-DO)'
)
select count(*) as no_op_fix_rounds,
  round(sum(n.cost_usd)::numeric, 2) as fix_cost_usd,
  coalesce(sum(f.runs), 0) as follow_up_runs,
  round(coalesce(sum(f.cost_usd), 0)::numeric, 2) as follow_up_cost_usd,
  round((sum(n.cost_usd) + coalesce(sum(f.cost_usd), 0))::numeric, 2) as total_cost_usd
from no_op n
left join lateral (
  select count(*) as runs, sum(c.cost_usd) as cost_usd
  from runs c
  where c.ticket_id = n.ticket_id and c.kind in ('verify', 'review')
    and c.queued_at > n.queued_at and (n.next_fix_at is null or c.queued_at < n.next_fix_at)
) f on true;

\echo
\echo '== Fix rounds per ticket =='
with per_ticket as (
  select t.id, count(r.id) filter (where r.kind = 'fix') as fix_rounds
  from tickets t
  left join runs r on r.ticket_id = t.id
  group by t.id
)
select fix_rounds, count(*) as tickets
from per_ticket
group by fix_rounds
order by fix_rounds;

\echo
\echo '== Cost and wall-clock per approved ticket (first run queued to last run finished) =='
with spend as (
  select t.id, sum(r.cost_usd) as cost_usd,
    extract(epoch from (max(r.finished_at) - min(r.queued_at))) / 60 as minutes
  from tickets t
  join runs r on r.ticket_id = t.id
  where t.status in ('approved', 'merged')
  group by t.id
)
select count(*) as tickets,
  round(avg(cost_usd)::numeric, 2) as avg_cost_usd,
  round((percentile_cont(0.5) within group (order by cost_usd))::numeric, 2) as median_cost_usd,
  round(avg(minutes)::numeric, 1) as avg_minutes,
  round((percentile_cont(0.5) within group (order by minutes))::numeric, 1) as median_minutes
from spend;

\echo
\echo '== Blocked reasons =='
select coalesce(left(blocked_reason, 100), '(none recorded)') as reason, count(*) as tickets
from tickets
where status = 'blocked'
group by 1
order by tickets desc;

\echo
\echo '== Review and verify approval by role prompt and model (needs migration 006) =='
select kind, coalesce(left(role_sha, 8), '(before 006)') as role_sha, model, count(*) as runs,
  round(100.0 * count(*) filter (where verdict like 'VERDICT: APPROVE%') / count(*), 1) as approval_pct
from runs
where kind in ('review', 'verify') and status = 'succeeded'
group by kind, role_sha, model
order by kind, max(queued_at) desc;

\echo
\echo '== Fix no-op rate by role prompt and model (needs migration 006) =='
select coalesce(left(role_sha, 8), '(before 006)') as role_sha, model, count(*) as runs,
  round(100.0 * count(*) filter (where verdict ~* '^FIX:\s*(NO-CHANGES|NOTHING-TO-DO)') / count(*), 1) as no_op_pct
from runs
where kind = 'fix' and status = 'succeeded'
group by role_sha, model
order by max(queued_at) desc;

rollback;
