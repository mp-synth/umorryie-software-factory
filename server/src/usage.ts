import fs from 'node:fs';
import path from 'node:path';
import { MODEL_VERSIONS, type Model, type UsageBucket, type UsageSession, type UsageSummary, type UsageTokens, type UsageWeek } from '@factory/shared';
import { sql } from './db.ts';
import { emitChange } from './events.ts';
import { ticketLabel } from './pipeline/labels.ts';
import {
  claudeProjectsDir,
  factoryKindOf,
  findTranscript,
  initiativeIdPrefix,
  labelFromPrompt,
  peekSession,
  readSessionUsage,
  type SessionUsage,
} from './usage-transcript.ts';

// The usage ledger: one row per agent session the factory started, priced from the
// session's transcript. Runs are not a ledger: resetting or deleting an initiative deletes
// its runs, and an agent that never reports its result leaves its run without a cost.

interface LedgerRow {
  sessionId: string;
  runId: string | null;
  initiativeId: string | null;
  kind: string;
  label: string | null;
  model: string | null;
  effort: string | null;
  cwd: string | null;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  requests: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
  reportedCostUsd: number | null;
  pricedFrom: 'transcript' | 'cli';
  unpricedRequests: number;
}

type Spend = Pick<
  LedgerRow,
  'requests' | 'inputTokens' | 'cacheWriteTokens' | 'cacheReadTokens' | 'outputTokens' | 'costUsd' | 'reportedCostUsd' | 'pricedFrom' | 'unpricedRequests'
>;

type CliTotals = Pick<RunForUsage, 'numTurns' | 'inputTokens' | 'outputTokens'>;

const NO_CLI_TOTALS: CliTotals = { numTurns: null, inputTokens: null, outputTokens: null };

interface RunForUsage {
  id: string;
  sessionId: string | null;
  kind: string;
  model: string | null;
  effort: string | null;
  cwd: string | null;
  initiativeId: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  numTurns: number | null;
  initiativeTitle: string;
  ticketSeq: number | null;
  ticketTitle: string | null;
}

const DAY_MS = 86_400_000;

function modelId(model: string | null): string | null {
  return model ? (MODEL_VERSIONS[model as Model]?.id ?? model) : null;
}

/**
 * What a session spent. The transcript prices every response, unless some ran on a model
 * without a known price: then the CLI's own total, which covers them, is the better figure.
 */
export function spendOf(usage: SessionUsage | null, reportedCostUsd: number | null, cli: CliTotals = NO_CLI_TOTALS): Spend {
  if (!usage) {
    return {
      requests: cli.numTurns ?? 0,
      // Without a transcript only the CLI's totals exist, and its input count includes cache traffic.
      inputTokens: cli.inputTokens ?? 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: cli.outputTokens ?? 0,
      costUsd: reportedCostUsd ?? 0,
      reportedCostUsd,
      pricedFrom: 'cli',
      unpricedRequests: 0,
    };
  }
  const partlyPriced = usage.unpriced > 0 && reportedCostUsd != null;
  return {
    requests: usage.requests,
    inputTokens: usage.tokens.input,
    cacheWriteTokens: usage.tokens.cacheWrite,
    cacheReadTokens: usage.tokens.cacheRead,
    outputTokens: usage.tokens.output,
    costUsd: partlyPriced ? Math.max(usage.costUsd, reportedCostUsd) : usage.costUsd,
    reportedCostUsd,
    pricedFrom: partlyPriced ? 'cli' : 'transcript',
    unpricedRequests: usage.unpriced,
  };
}

function fromRun(run: RunForUsage, usage: SessionUsage | null): LedgerRow {
  return {
    sessionId: run.sessionId!,
    runId: run.id,
    initiativeId: run.initiativeId,
    kind: run.kind,
    label: run.ticketTitle ? `${run.initiativeTitle} · ${ticketLabel({ seq: run.ticketSeq ?? 0, title: run.ticketTitle })}` : run.initiativeTitle,
    model: usage?.model ?? modelId(run.model),
    effort: run.effort,
    cwd: run.cwd ?? usage?.cwd ?? null,
    startedAt: usage?.startedAt ?? run.startedAt ?? new Date(),
    finishedAt: usage?.finishedAt ?? run.finishedAt,
    ...spendOf(usage, run.costUsd, run),
  };
}

export type LedgerPricing = Pick<LedgerRow, 'sessionId' | 'pricedFrom' | 'costUsd' | 'reportedCostUsd' | 'requests' | 'unpricedRequests'>;

/**
 * Which recorded sessions the backfill skips, and which it reads again from their transcript
 * however old: those priced from the CLI's total, and those with responses that had no price
 * (recorded at $0 before unpriced responses were counted, or counted since).
 */
export function backfillPlan(ledger: LedgerPricing[]): { known: Set<string>; reread: Set<string> } {
  const known = new Set<string>();
  const reread = new Set<string>();
  for (const r of ledger) {
    const notFullyPriced = r.pricedFrom === 'cli' || r.unpricedRequests > 0 || (r.costUsd === 0 && r.requests > 0);
    (notFullyPriced ? reread : known).add(r.sessionId);
  }
  return { known, reread };
}

async function save(row: LedgerRow, announce = true): Promise<void> {
  const { sessionId: _key, ...rest } = row;
  await sql`insert into agent_usage ${sql(row as unknown as Record<string, unknown>)}
    on conflict (session_id) do update set ${sql(rest as unknown as Record<string, unknown>)}`;
  if (announce) emitChange({ type: 'usage', id: row.sessionId, initiativeId: row.initiativeId });
}

async function runsForUsage(where: { runId?: string; withSession?: boolean }): Promise<RunForUsage[]> {
  return sql<RunForUsage[]>`
    select r.id, r.session_id, r.kind, r.model, r.effort, r.cwd, r.initiative_id, r.started_at, r.finished_at,
      r.cost_usd, r.input_tokens, r.output_tokens, r.num_turns,
      i.title as initiative_title, t.seq as ticket_seq, t.title as ticket_title
    from runs r join initiatives i on i.id = r.initiative_id left join tickets t on t.id = r.ticket_id
    where ${where.runId ? sql`r.id = ${where.runId}` : sql`r.session_id is not null`}`;
}

/** Records what a run's agent session spent. Called when its agent ends, however it ends. */
export async function recordRunUsage(runId: string): Promise<void> {
  const [run] = await runsForUsage({ runId });
  if (!run?.sessionId) return;
  const file = findTranscript(run.sessionId, run.cwd);
  const usage = file ? await readSessionUsage(file) : null;
  if (!usage && run.costUsd == null) return;
  await save(fromRun(run, usage));
}

/** Records a project-discovery agent, which runs before there is any initiative or run. */
export async function recordDiscoveryUsage(sessionId: string | null, dir: string, reportedCostUsd: number | null): Promise<void> {
  if (!sessionId) return;
  const file = findTranscript(sessionId, dir);
  const usage = file ? await readSessionUsage(file) : null;
  if (!usage && reportedCostUsd == null) return;
  await save({
    sessionId,
    runId: null,
    initiativeId: null,
    kind: 'discovery',
    label: path.basename(dir),
    model: usage?.model ?? MODEL_VERSIONS.sonnet.id,
    effort: 'medium',
    cwd: dir,
    startedAt: usage?.startedAt ?? new Date(),
    finishedAt: usage?.finishedAt ?? new Date(),
    ...spendOf(usage, reportedCostUsd),
  });
}

/**
 * Fills the ledger from the transcripts on disk: every session of a known run, and every
 * factory session whose run is gone (deleted with its initiative, reset, or started by a
 * test server). Runs whose transcript Claude Code already pruned keep the CLI's own figure.
 * Once a pass has read every transcript, later passes read only those written since it
 * started, so a restart costs little.
 */
export async function backfillUsage(): Promise<number> {
  const passStartedAt = new Date();
  const [marker] = await sql<{ scannedUpTo: Date }[]>`select scanned_up_to from usage_backfill where id = 1`;
  const since = marker?.scannedUpTo.getTime() ?? 0;
  const ledger = await sql<LedgerPricing[]>`
    select session_id, priced_from, cost_usd, reported_cost_usd, requests, unpriced_requests from agent_usage`;
  const { known, reread } = backfillPlan(ledger);
  const reportedCosts = new Map(ledger.map((r) => [r.sessionId, r.reportedCostUsd]));
  const runs = new Map((await runsForUsage({ withSession: true })).map((r) => [r.sessionId!, r]));
  const initiativeIds = (await sql<{ id: string }[]>`select id from initiatives`).map((r) => r.id);
  const root = claudeProjectsDir();
  let recorded = 0;
  let failed = 0;
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    // no transcripts on this machine
  }
  for (const dir of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const name of names) {
      const sessionId = name.slice(0, -'.jsonl'.length);
      const file = path.join(root, dir, name);
      if (known.has(sessionId)) continue;
      try {
        if (since && !reread.has(sessionId) && fs.statSync(file).mtimeMs < since) continue;
        const run = runs.get(sessionId);
        if (!run && !factoryKindOf(await peekSession(file))) continue;
        const usage = await readSessionUsage(file);
        if (!usage) continue;
        if (run) {
          await save(fromRun(run, usage), false);
        } else {
          const prefix = initiativeIdPrefix(usage.cwd);
          await save(
            {
              sessionId,
              runId: null,
              initiativeId: prefix ? (initiativeIds.find((id) => id.startsWith(prefix)) ?? null) : null,
              kind: factoryKindOf(usage) ?? 'other',
              label: labelFromPrompt(usage.firstPrompt),
              model: usage.model,
              effort: null,
              cwd: usage.cwd,
              startedAt: usage.startedAt,
              finishedAt: usage.finishedAt,
              ...spendOf(usage, reportedCosts.get(sessionId) ?? null),
            },
            false,
          );
        }
        known.add(sessionId);
        recorded++;
      } catch (err) {
        failed++;
        console.error(`[usage] could not read ${file}:`, (err as Error).message);
      }
    }
  }
  for (const run of runs.values()) {
    if (known.has(run.sessionId!) || reread.has(run.sessionId!) || run.costUsd == null) continue;
    await save(fromRun(run, null), false);
    recorded++;
  }
  if (!failed) {
    await sql`insert into usage_backfill (id, scanned_up_to) values (1, ${passStartedAt})
      on conflict (id) do update set scanned_up_to = excluded.scanned_up_to`;
  }
  if (recorded) emitChange({ type: 'usage', id: 'backfill' });
  return recorded;
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addBucket(map: Map<string, UsageBucket>, key: string, costUsd: number, sessions: number): void {
  const b = map.get(key) ?? { key, costUsd: 0, sessions: 0 };
  b.costUsd += costUsd;
  b.sessions += sessions;
  map.set(key, b);
}

export async function usageSummary(from: Date, to: Date): Promise<UsageSummary> {
  const rows = await sql<{ day: string; kind: string; model: string | null; sessions: number; costUsd: number; input: number; cacheWrite: number; cacheRead: number; output: number }[]>`
    select to_char(started_at at time zone 'UTC', 'YYYY-MM-DD') as day, kind, model, count(*)::int as sessions,
      sum(cost_usd)::float8 as cost_usd, sum(input_tokens)::float8 as input, sum(cache_write_tokens)::float8 as cache_write,
      sum(cache_read_tokens)::float8 as cache_read, sum(output_tokens)::float8 as output
    from agent_usage where started_at >= ${from} and started_at < ${to}
    group by 1, 2, 3`;
  const byDay = new Map<string, UsageBucket>();
  for (let t = Date.parse(`${utcDay(from)}T00:00:00Z`); t < to.getTime(); t += DAY_MS) addBucket(byDay, utcDay(new Date(t)), 0, 0);
  const byKind = new Map<string, UsageBucket>();
  const byModel = new Map<string, UsageBucket>();
  const tokens: UsageTokens = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  let costUsd = 0;
  let sessions = 0;
  for (const r of rows) {
    addBucket(byDay, r.day, r.costUsd, r.sessions);
    addBucket(byKind, r.kind, r.costUsd, r.sessions);
    addBucket(byModel, r.model ?? 'unknown', r.costUsd, r.sessions);
    tokens.input += r.input;
    tokens.cacheWrite += r.cacheWrite;
    tokens.cacheRead += r.cacheRead;
    tokens.output += r.output;
    costUsd += r.costUsd;
    sessions += r.sessions;
  }
  const ranked = (m: Map<string, UsageBucket>) => [...m.values()].sort((a, b) => b.costUsd - a.costUsd);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    costUsd,
    sessions,
    tokens,
    byDay: [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byKind: ranked(byKind),
    byModel: ranked(byModel),
  };
}

export async function usageSessions(from: Date, to: Date, limit = 2000): Promise<UsageSession[]> {
  const rows = await sql<(LedgerRow & { startedAt: Date; finishedAt: Date | null; runStatus: string | null; verdict: string | null })[]>`
    select u.*, r.status as run_status, r.verdict
    from agent_usage u left join runs r on r.id = u.run_id
    where u.started_at >= ${from} and u.started_at < ${to}
    order by u.started_at desc limit ${limit}`;
  return rows.map((r) => ({
    sessionId: r.sessionId,
    runId: r.runId,
    initiativeId: r.initiativeId,
    kind: r.kind,
    label: r.label,
    model: r.model,
    effort: r.effort,
    startedAt: new Date(r.startedAt).toISOString(),
    finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
    requests: r.requests,
    tokens: { input: Number(r.inputTokens), cacheWrite: Number(r.cacheWriteTokens), cacheRead: Number(r.cacheReadTokens), output: Number(r.outputTokens) },
    costUsd: r.costUsd,
    reportedCostUsd: r.reportedCostUsd,
    pricedFrom: r.pricedFrom,
    runStatus: r.runStatus,
    verdict: r.verdict,
  }));
}

export async function usageWeeks(): Promise<UsageWeek[]> {
  const rows = await sql<{ weekStart: string; costUsd: number; sessions: number }[]>`
    select to_char(date_trunc('week', started_at at time zone 'UTC'), 'YYYY-MM-DD') as week_start,
      sum(cost_usd)::float8 as cost_usd, count(*)::int as sessions
    from agent_usage group by 1 order by 1 desc`;
  return rows.map((r) => ({ weekStart: `${r.weekStart}T00:00:00.000Z`, costUsd: r.costUsd, sessions: r.sessions }));
}
