import type { PlanTicket, Run, Ticket } from '@factory/shared';
import type { OrderedTicket } from './plan.ts';
import { parseVerdict } from './verdict.ts';

type Existing = Pick<Ticket, 'id' | 'key' | 'seq' | 'status' | 'branch' | 'title' | 'what' | 'goal' | 'outcome' | 'guidance' | 'acceptance' | 'dependsOn' | 'size'>;

export interface RevisedPlan<T extends Existing> {
  // Tickets the factory already holds that the revised plan keeps, with their new text and order.
  keep: { ticket: T; spec: PlanTicket; order: OrderedTicket }[];
  // Started, unmerged tickets to build again from their base: their text changed, or they build on one that did.
  rebuild: T[];
  // Kept tickets not started yet whose text changed: they start over from the new text.
  restart: T[];
  // Unmerged tickets the revised plan no longer has.
  drop: T[];
}

const SETTLED: Ticket['status'][] = ['merged', 'canceled'];

export function wasApproved(t: Pick<Ticket, 'status'>): boolean {
  return t.status !== 'proposed' && t.status !== 'canceled';
}

const normalized = (s: string) => s.trim().replace(/\s+/g, ' ');
const sameText = (a: string, b: string) => normalized(a) === normalized(b);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => sameText(x, b[i]));
const sameSet = (a: string[], b: string[]) => sameList(a.map(normalized).sort(), b.map(normalized).sort());

export function sameSpec(t: Existing, p: PlanTicket): boolean {
  return (
    sameText(t.title, p.title) &&
    sameText(t.what, p.what) &&
    sameText(t.goal, p.goal) &&
    sameText(t.outcome, p.outcome) &&
    t.size === p.size &&
    sameList(t.guidance, p.guidance) &&
    sameList(t.acceptance, p.acceptance) &&
    sameSet(t.dependsOn, p.depends_on)
  );
}

// Tickets that exist keep their number; the plan's new ones are numbered after the highest, so no two share one.
export function planTicketSeqs(order: OrderedTicket[], existing: Pick<Ticket, 'key' | 'seq' | 'status'>[]): Map<string, number> {
  const held = existing.filter((t) => t.status !== 'proposed');
  const seqOf = new Map(held.map((t) => [t.key, t.seq]));
  let next = Math.max(0, ...held.map((t) => t.seq));
  return new Map(order.map((o) => [o.key, seqOf.get(o.key) ?? ++next]));
}

// A planner revising an approved plan asked the owner questions, and no approval has come since.
export function replanAwaitsAnswers(lastPlanRun: Pick<Run, 'queuedAt' | 'verdict'> | null, approvedAt: string | null): boolean {
  if (!lastPlanRun || !approvedAt) return false;
  return new Date(lastPlanRun.queuedAt).getTime() > new Date(approvedAt).getTime() && parseVerdict('plan', lastPlanRun.verdict) === 'BLOCKED';
}

const MAX_KEY_LENGTH = 32;

/**
 * A revised plan may name a new ticket with the key of one an earlier round canceled. The canceled
 * row keeps that key (and its runs, which go if the row is deleted), and a plan's tickets are stored
 * by key, so the new ticket would be silently lost. It gets the next free key instead (`key-2`), with
 * `depends_on` in the plan following it. `raw` is the planner's plan.json before validation.
 */
export function renameCanceledKeys(raw: unknown, canceled: ReadonlySet<string>, taken: ReadonlySet<string>): { raw: unknown; renamed: [string, string][] } {
  const tickets = (raw as { tickets?: unknown } | null)?.tickets;
  if (!canceled.size || !Array.isArray(tickets)) return { raw, renamed: [] };
  const keyOf = (t: unknown) => (t && typeof t === 'object' && typeof (t as { key?: unknown }).key === 'string' ? (t as { key: string }).key : null);
  const used = new Set([...taken, ...tickets.map(keyOf).filter((k): k is string => !!k)]);
  const renames = new Map<string, string>();
  for (const t of tickets) {
    const key = keyOf(t);
    if (!key || !canceled.has(key) || renames.has(key)) continue;
    let next = key;
    for (let n = 2; used.has(next); n++) next = `${key.slice(0, MAX_KEY_LENGTH - String(n).length - 1)}-${n}`;
    used.add(next);
    renames.set(key, next);
  }
  if (!renames.size) return { raw, renamed: [] };
  const rename = (k: unknown) => (typeof k === 'string' ? (renames.get(k) ?? k) : k);
  const renamedTickets = tickets.map((t) => {
    if (!t || typeof t !== 'object') return t;
    const ticket = t as { key?: unknown; depends_on?: unknown };
    return { ...ticket, key: rename(ticket.key), ...(Array.isArray(ticket.depends_on) ? { depends_on: ticket.depends_on.map(rename) } : {}) };
  });
  return { raw: { ...(raw as object), tickets: renamedTickets }, renamed: [...renames] };
}

// A plan revised after approval meets tickets that already exist. Proposed rows are the
// new plan's own; anything else was approved earlier and may have a branch and a PR.
export function revisePlannedTickets<T extends Existing>(planned: PlanTicket[], order: OrderedTicket[], existing: T[]): RevisedPlan<T> {
  const byKey = new Map(planned.map((p) => [p.key, p]));
  const orderOf = new Map(order.map((o) => [o.key, o]));
  const approved = existing.filter(wasApproved);
  const keep = approved.filter((t) => byKey.has(t.key)).map((t) => ({ ticket: t, spec: byKey.get(t.key)!, order: orderOf.get(t.key)! }));
  const drop = approved.filter((t) => !byKey.has(t.key) && !SETTLED.includes(t.status));

  const moved = new Set([...drop.map((t) => t.key), ...keep.filter((k) => !SETTLED.includes(k.ticket.status) && !sameSpec(k.ticket, k.spec)).map((k) => k.ticket.key)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { ticket, spec } of keep) {
      if (moved.has(ticket.key) || SETTLED.includes(ticket.status) || !ticket.branch) continue;
      if ([...ticket.dependsOn, ...spec.depends_on].some((k) => moved.has(k))) {
        moved.add(ticket.key);
        grew = true;
      }
    }
  }
  const changed = keep.map((k) => k.ticket).filter((t) => moved.has(t.key) && !SETTLED.includes(t.status));
  return { keep, rebuild: changed.filter((t) => t.branch), restart: changed.filter((t) => !t.branch), drop };
}
