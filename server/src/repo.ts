import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_INITIATIVE_SETTINGS,
  PR_SWEEP_CLAIM_MINUTES,
  type AppSettings,
  type Initiative,
  type InitiativeSettings,
  type InitiativeSummary,
  type Message,
  type Project,
  type Rule,
  type Run,
  type RunEvent,
  type RunEventType,
  type Ticket,
} from '@factory/shared';
import { json, sql } from './db.ts';
import { emitChange, emitRunEvent } from './events.ts';

const JSON_COLUMNS = new Set(['planJson', 'settings', 'guidance', 'acceptance', 'dependsOn', 'data', 'copyFiles', 'referenceDirs']);

function prepare(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = JSON_COLUMNS.has(k) && v !== null ? json(v) : v;
  }
  return out;
}

export async function getAppSettings(): Promise<AppSettings> {
  const [row] = await sql<{ data: Partial<AppSettings> }[]>`select data from app_settings where id = 1`;
  return { ...DEFAULT_APP_SETTINGS, ...(row?.data ?? {}) };
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getAppSettings()), ...patch };
  await sql`update app_settings set data = ${json(next)}, updated_at = now() where id = 1`;
  emitChange({ type: 'settings', id: 'app' });
  return next;
}

export function initiativeSettings(i: Pick<Initiative, 'settings'>): InitiativeSettings {
  const s = (i.settings ?? {}) as Partial<InitiativeSettings>;
  return {
    ...DEFAULT_INITIATIVE_SETTINGS,
    ...s,
    models: { ...DEFAULT_INITIATIVE_SETTINGS.models, ...(s.models ?? {}) },
  };
}

export async function listProjects(): Promise<Project[]> {
  return sql<Project[]>`select * from projects order by name`;
}

export async function getProject(id: string): Promise<Project | null> {
  const [p] = await sql<Project[]>`select * from projects where id = ${id}`;
  return p ?? null;
}

export async function insertProject(p: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
  const [row] = await sql<Project[]>`insert into projects ${sql(prepare(p))} returning *`;
  emitChange({ type: 'project', id: row.id });
  return row;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<Project> {
  const [row] = await sql<Project[]>`update projects set ${sql(prepare(patch))}, updated_at = now() where id = ${id} returning *`;
  emitChange({ type: 'project', id });
  return row;
}

export async function deleteProject(id: string): Promise<void> {
  await sql`delete from projects where id = ${id}`;
  emitChange({ type: 'project', id });
}

function normalizeInitiative(i: Initiative): Initiative {
  return { ...i, settings: initiativeSettings(i) };
}

export async function getInitiative(id: string): Promise<Initiative | null> {
  const [i] = await sql<Initiative[]>`select * from initiatives where id = ${id}`;
  return i ? normalizeInitiative(i) : null;
}

export async function insertInitiative(
  i: Pick<Initiative, 'projectId' | 'slug' | 'title' | 'brief' | 'baseBranch' | 'settings'> & Partial<Pick<Initiative, 'kind'>>,
): Promise<Initiative> {
  const [row] = await sql<Initiative[]>`insert into initiatives ${sql(prepare(i))} returning *`;
  emitChange({ type: 'initiative', id: row.id, initiativeId: row.id });
  return normalizeInitiative(row);
}

export async function updateInitiative(id: string, patch: Partial<Initiative>): Promise<Initiative> {
  const [row] = await sql<Initiative[]>`update initiatives set ${sql(prepare(patch))}, updated_at = now() where id = ${id} returning *`;
  emitChange({ type: 'initiative', id, initiativeId: id });
  return normalizeInitiative(row);
}

export async function moveInitiativeStatus(id: string, from: Initiative['status'], to: Initiative['status']): Promise<boolean> {
  const moved = await sql`update initiatives set status = ${to}, updated_at = now() where id = ${id} and status = ${from} returning id`;
  if (moved.length) emitChange({ type: 'initiative', id, initiativeId: id });
  return moved.length > 0;
}

export async function initiativeCost(id: string): Promise<number> {
  const [{ cost }] = await sql<{ cost: number }[]>`select coalesce(sum(cost_usd), 0)::float8 as cost from runs where initiative_id = ${id}`;
  return cost;
}

export async function deleteInitiative(id: string): Promise<void> {
  await sql`delete from initiatives where id = ${id}`;
  emitChange({ type: 'initiative', id, initiativeId: id });
}

export async function listInitiativeSummaries(): Promise<InitiativeSummary[]> {
  const rows = await sql<(Initiative & { projectName: string; repoPath: string; costUsd: number; activeRuns: number })[]>`
    select i.*, p.name as project_name, p.repo_path,
      coalesce((select sum(cost_usd) from runs r where r.initiative_id = i.id), 0)::float8 as cost_usd,
      (select count(*) from runs r where r.initiative_id = i.id and r.status in ('queued','running'))::int as active_runs
    from initiatives i join projects p on p.id = i.project_id
    order by (i.status = 'archived'), i.updated_at desc`;
  const counts = await sql<{ initiativeId: string; status: string; n: number }[]>`
    select initiative_id, status, count(*)::int as n from tickets group by initiative_id, status`;
  const arbitrating = await sql<{ initiativeId: string; ticketId: string | null }[]>`
    select initiative_id, ticket_id from runs where kind = 'arbitrate' and status in ('queued','running')`;
  return rows.map((r) => {
    const ticketCounts: Record<string, number> = {};
    for (const c of counts) if (c.initiativeId === r.id) ticketCounts[c.status] = c.n;
    const ticketTotal = Object.entries(ticketCounts)
      .filter(([s]) => s !== 'canceled')
      .reduce((a, [, n]) => a + n, 0);
    const scopes = arbitrating.filter((a) => a.initiativeId === r.id);
    return {
      ...normalizeInitiative(r),
      ticketCounts,
      ticketTotal,
      attention: attentionFor(r.status, ticketCounts, { plan: scopes.some((a) => !a.ticketId), tickets: scopes.filter((a) => a.ticketId).length }),
    } as InitiativeSummary;
  });
}

export function attentionFor(status: string, counts: Record<string, number>, arbitrating: { plan: boolean; tickets: number }): string | null {
  if (!arbitrating.plan) {
    if (status === 'awaiting_approval') return 'Plan ready for your review';
    if (status === 'needs_input') return 'Planner has questions for you';
    if (status === 'failed') return 'Planning failed';
  }
  const blocked = (counts.blocked ?? 0) - arbitrating.tickets;
  if (blocked > 0) return `${blocked} ticket${blocked > 1 ? 's' : ''} blocked`;
  return null;
}

export async function listTickets(initiativeId: string): Promise<Ticket[]> {
  return sql<Ticket[]>`select * from tickets where initiative_id = ${initiativeId} order by seq`;
}

export async function getTicket(id: string): Promise<Ticket | null> {
  const [t] = await sql<Ticket[]>`select * from tickets where id = ${id}`;
  return t ?? null;
}

export async function updateTicket(id: string, patch: Partial<Ticket>): Promise<Ticket> {
  const [row] = await sql<Ticket[]>`update tickets set ${sql(prepare(patch))}, updated_at = now() where id = ${id} returning *`;
  emitChange({ type: 'ticket', id, initiativeId: row.initiativeId });
  return row;
}

function touchTicket(row: Ticket | undefined): Ticket | null {
  if (row) emitChange({ type: 'ticket', id: row.id, initiativeId: row.initiativeId });
  return row ?? null;
}

export async function insertTicketIfNew(t: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'>): Promise<Ticket | null> {
  const [row] = await sql<Ticket[]>`insert into tickets ${sql(prepare(t))} on conflict (initiative_id, key) do nothing returning *`;
  return touchTicket(row);
}

export async function openPrsInitiative(projectId: string): Promise<Initiative | null> {
  const [i] = await sql<Initiative[]>`select * from initiatives where project_id = ${projectId} and kind = 'open-prs'`;
  return i ? normalizeInitiative(i) : null;
}

export async function trackedPrNumbers(projectId: string): Promise<Set<number>> {
  const rows = await sql<{ prNumber: number }[]>`
    select t.pr_number from tickets t join initiatives i on i.id = t.initiative_id
    where i.project_id = ${projectId} and t.pr_number is not null`;
  return new Set(rows.map((r) => r.prNumber));
}

export async function nextTicketSeq(initiativeId: string): Promise<number> {
  const [{ next }] = await sql<{ next: number }[]>`select coalesce(max(seq), 0)::int + 1 as next from tickets where initiative_id = ${initiativeId}`;
  return next;
}

export async function claimPrSweep(ticketId: string, fingerprint: string): Promise<Ticket | null> {
  const [row] = await sql<Ticket[]>`
    update tickets set pr_sweep_claimed_at = now(), pr_sweep_fingerprint = ${fingerprint}, updated_at = now()
    where id = ${ticketId}
      and (pr_sweep_claimed_at is null or pr_sweep_claimed_at < now() - make_interval(mins => ${PR_SWEEP_CLAIM_MINUTES}))
    returning *`;
  return touchTicket(row);
}

export async function releasePrSweepClaim(ticketId: string, opts: { forgetState: boolean }): Promise<boolean> {
  const [row] = await sql<Ticket[]>`
    update tickets set pr_sweep_claimed_at = null, ${opts.forgetState ? sql`pr_sweep_fingerprint = null,` : sql``} updated_at = now()
    where id = ${ticketId} and pr_sweep_claimed_at is not null
    returning *`;
  return !!touchTicket(row);
}

export async function listPrSweepClaims(): Promise<Ticket[]> {
  return sql<Ticket[]>`select * from tickets where pr_sweep_claimed_at is not null`;
}

export async function getRun(id: string): Promise<Run | null> {
  const [r] = await sql<Run[]>`select * from runs where id = ${id}`;
  return r ?? null;
}

export async function insertRun(r: Partial<Run> & Pick<Run, 'initiativeId' | 'kind'>): Promise<Run> {
  const [row] = await sql<Run[]>`insert into runs ${sql(prepare(r))} returning *`;
  emitChange({ type: 'run', id: row.id, initiativeId: row.initiativeId });
  return row;
}

export async function updateRun(id: string, patch: Partial<Run> & { pid?: number | null }): Promise<Run> {
  const [row] = await sql<Run[]>`update runs set ${sql(prepare(patch))} where id = ${id} returning *`;
  emitChange({ type: 'run', id, initiativeId: row.initiativeId });
  return row;
}

export function ticketScope(initiativeId: string, ticketId: string | null) {
  return ticketId ? sql`ticket_id = ${ticketId}` : sql`initiative_id = ${initiativeId} and ticket_id is null`;
}

const runsWithTitles = () => sql`
  select r.*, i.title as initiative_title, t.title as ticket_title, t.seq as ticket_seq
  from runs r
  join initiatives i on i.id = r.initiative_id
  left join tickets t on t.id = r.ticket_id`;

export async function listRuns(opts: { initiativeId?: string; ticketId?: string; active?: boolean; limit?: number }): Promise<Run[]> {
  const limit = opts.limit ?? 200;
  return sql<Run[]>`
    ${runsWithTitles()}
    where true
      ${opts.initiativeId ? sql`and r.initiative_id = ${opts.initiativeId}` : sql``}
      ${opts.ticketId ? sql`and r.ticket_id = ${opts.ticketId}` : sql``}
      ${opts.active ? sql`and r.status in ('queued','running')` : sql``}
    order by (r.status = 'running') desc, (r.status = 'queued') desc, r.queued_at desc
    limit ${limit}`;
}

export async function listRunsById(id: string): Promise<Run[]> {
  return sql<Run[]>`${runsWithTitles()} where r.id = ${id}`;
}

export async function arbiterDecisionsSinceOwner(initiativeId: string, ticketId: string | null): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from runs
    where ${ticketScope(initiativeId, ticketId)} and kind = 'arbitrate' and status = 'succeeded'
      and upper(regexp_replace(verdict, '[[:space:]]+', '', 'g')) in ('DECISION:APPROVE', 'DECISION:RETRY')
      and queued_at > coalesce(
        (select max(created_at) from messages where ${ticketScope(initiativeId, ticketId)} and author = 'human'),
        'epoch'::timestamptz)`;
  return n;
}

export async function lastStoppedStep(initiativeId: string, ticketId: string | null): Promise<Run | null> {
  const [r] = await sql<Run[]>`
    select * from runs where ${ticketScope(initiativeId, ticketId)} and kind not in ('arbitrate', 'ask', 'steer', 'retro') and status not in ('queued', 'running')
    order by queued_at desc limit 1`;
  return r ?? null;
}

export async function latestRun(initiativeId: string, ticketId: string | null, kind: string): Promise<Run | null> {
  const [r] = await sql<Run[]>`
    select * from runs where ${ticketScope(initiativeId, ticketId)} and kind = ${kind} and status = 'succeeded'
    order by queued_at desc limit 1`;
  return r ?? null;
}

export async function addRunEvent(runId: string, type: RunEventType, data: Record<string, unknown>): Promise<void> {
  const [row] = await sql<RunEvent[]>`insert into run_events (run_id, type, data) values (${runId}, ${type}, ${json(data)}) returning *`;
  emitRunEvent(runId, { ...row, id: String(row.id) });
}

export interface RunSpool {
  runId: string;
  dir: string;
  stdoutOffset: number;
  stderrOffset: number;
  state: unknown;
}

type RunSpoolRow = Omit<RunSpool, 'stdoutOffset' | 'stderrOffset'> & { stdoutOffset: string; stderrOffset: string };

const toRunSpool = (row: RunSpoolRow): RunSpool => ({ ...row, stdoutOffset: Number(row.stdoutOffset), stderrOffset: Number(row.stderrOffset) });

export async function insertRunSpool(runId: string, dir: string, state: unknown): Promise<RunSpool> {
  const [row] = await sql<RunSpoolRow[]>`insert into run_spools (run_id, dir, state) values (${runId}, ${dir}, ${json(state)}) returning *`;
  return toRunSpool(row);
}

export async function getRunSpool(runId: string): Promise<RunSpool | null> {
  const [row] = await sql<RunSpoolRow[]>`select * from run_spools where run_id = ${runId}`;
  return row ? toRunSpool(row) : null;
}

export async function listRunSpools(): Promise<RunSpool[]> {
  return (await sql<RunSpoolRow[]>`select * from run_spools`).map(toRunSpool);
}

export async function deleteRunSpool(runId: string): Promise<void> {
  await sql`delete from run_spools where run_id = ${runId}`;
}

export async function addSpooledRunEvents(
  runId: string,
  events: { type: RunEventType; data: Record<string, unknown> }[],
  readUpTo: { stdout: number; stderr: number },
): Promise<void> {
  const rows = await sql.begin(async (tx) => {
    await tx`update run_spools set stdout_offset = ${readUpTo.stdout}, stderr_offset = ${readUpTo.stderr} where run_id = ${runId}`;
    return tx<RunEvent[]>`insert into run_events ${tx(events.map((e) => ({ runId, type: e.type, data: json(e.data) })))} returning *`;
  });
  for (const row of [...rows].sort((a, b) => Number(a.id) - Number(b.id))) emitRunEvent(runId, { ...row, id: String(row.id) });
}

export async function listRunEvents(runId: string, afterId = 0, limit = 5000): Promise<RunEvent[]> {
  const rows = await sql<RunEvent[]>`select * from run_events where run_id = ${runId} and id > ${afterId} order by id limit ${limit}`;
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}

export async function addMessage(m: Pick<Message, 'initiativeId' | 'author' | 'body'> & Partial<Message>): Promise<Message> {
  const [row] = await sql<Message[]>`insert into messages ${sql(prepare(m))} returning *`;
  emitChange({ type: 'message', id: row.id, initiativeId: row.initiativeId });
  return row;
}

export async function listMessages(initiativeId: string): Promise<Message[]> {
  return sql<Message[]>`select * from messages where initiative_id = ${initiativeId} order by created_at`;
}

export async function pendingFeedback(initiativeId: string, ticketId: string | null): Promise<Message[]> {
  return sql<Message[]>`
    select * from messages where initiative_id = ${initiativeId} and ${ticketScope(initiativeId, ticketId)}
      and kind = 'feedback' and consumed_by_run is null
    order by created_at`;
}

export async function consumeFeedback(ids: string[], runId: string): Promise<void> {
  if (!ids.length) return;
  await sql`update messages set consumed_by_run = ${runId} where id in ${sql(ids)}`;
}

export async function retroScopes(initiativeId: string): Promise<Set<string>> {
  const rows = await sql<{ scope: string }[]>`
    select coalesce(ticket_id, initiative_id)::text as scope from runs
    where initiative_id = ${initiativeId} and kind = 'retro' and status <> 'canceled'`;
  return new Set(rows.map((r) => r.scope));
}

export async function ticketRetroInFlight(initiativeId: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from runs where initiative_id = ${initiativeId} and ticket_id is not null and kind = 'retro' and status in ('queued','running') limit 1`;
  return !!row;
}

export async function runIdsOfKind(initiativeId: string, kind: Run['kind']): Promise<Set<string>> {
  const rows = await sql<{ id: string }[]>`select id from runs where initiative_id = ${initiativeId} and kind = ${kind}`;
  return new Set(rows.map((r) => r.id));
}

function emitRuleChange(rule: Pick<Rule, 'id' | 'projectId' | 'initiativeId'>): void {
  emitChange({ type: 'project', id: rule.projectId });
  if (rule.initiativeId) emitChange({ type: 'initiative', id: rule.initiativeId, initiativeId: rule.initiativeId });
}

export async function insertRules(rows: Pick<Rule, 'projectId' | 'initiativeId' | 'ticketId' | 'runId' | 'scope' | 'role' | 'body' | 'why'>[]): Promise<Rule[]> {
  if (!rows.length) return [];
  const inserted = await sql<Rule[]>`insert into rules ${sql(rows.map((r) => prepare(r)))} returning *`;
  for (const r of inserted) emitRuleChange(r);
  return inserted;
}

export async function listRules(where: { projectId?: string; initiativeId?: string }): Promise<Rule[]> {
  return sql<Rule[]>`
    select * from rules where true
      ${where.projectId ? sql`and project_id = ${where.projectId}` : sql``}
      ${where.initiativeId ? sql`and initiative_id = ${where.initiativeId}` : sql``}
    order by created_at`;
}

export async function getRule(id: string): Promise<Rule | null> {
  const [r] = await sql<Rule[]>`select * from rules where id = ${id}`;
  return r ?? null;
}

export async function updateRule(id: string, patch: Partial<Pick<Rule, 'scope' | 'role' | 'body' | 'status' | 'decidedAt'>>): Promise<Rule> {
  const [r] = await sql<Rule[]>`update rules set ${sql(prepare(patch))} where id = ${id} returning *`;
  emitRuleChange(r);
  return r;
}

export async function acceptedProjectRules(projectId: string): Promise<Rule[]> {
  return sql<Rule[]>`select * from rules where project_id = ${projectId} and scope = 'project' and status = 'accepted' order by decided_at, created_at`;
}
