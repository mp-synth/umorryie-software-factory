import { z } from 'zod';
import type { PlanJson, PlanTicket } from '@factory/shared';

const bullet = z.string().trim().min(3).max(240);
const bullets = (min: number, max: number) => z.array(bullet).min(min).max(max);

const ticketSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/i, 'key: letters, digits, - and _, starts with a letter, max 32 chars'),
  title: z.string().trim().min(8).max(90).refine((t) => !/^\d/.test(t), 'title must not start with a number'),
  what: z.string().trim().min(10).max(400),
  goal: z.string().trim().min(10).max(400),
  outcome: z.string().trim().min(10).max(400),
  guidance: bullets(1, 8),
  acceptance: bullets(1, 8),
  depends_on: z.array(z.string()).max(8).default([]),
  size: z.enum(['XS', 'S', 'M']),
  touches: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  foundation: z.boolean().default(false),
});

export const planSchema = z.object({
  title: z.string().trim().min(3).max(120),
  summary: bullets(2, 6),
  goal: z.string().trim().min(10).max(600),
  success_criteria: bullets(1, 8),
  definition_of_done: bullets(1, 8),
  edge_cases: bullets(0, 10).default([]),
  test_strategy: bullets(1, 8),
  risks: bullets(0, 8).default([]),
  out_of_scope: bullets(0, 8).default([]),
  assumptions: bullets(0, 8).default([]),
  tickets: z.array(ticketSchema).min(1),
});

export interface OrderedTicket {
  key: string;
  seq: number;
  wave: number;
}

/**
 * `plan` keeps each ticket's `depends_on` as the planner wrote it; `needs` adds, for tickets whose write
 * sets overlap, the earlier one to what the later one waits for; `stacked` has the same tickets with
 * `depends_on` set to the one ticket each stacks on. Tickets that would
 * build side by side but touch the same files are chained, so their PRs never conflict with each other. With
 * `line`, every ticket stacks on the one before it in plan order: one GitHub stack, built as wide as the needs
 * allow.
 */
export function validatePlan(
  raw: unknown,
  maxTickets: number,
  opts: { line?: boolean } = {},
): { plan?: PlanJson; stacked?: PlanTicket[]; needs?: Map<string, string[]>; order?: OrderedTicket[]; errors: string[] } {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  const plan = parsed.data as PlanJson;
  const errors: string[] = [];
  if (plan.tickets.length > maxTickets) errors.push(`tickets: ${plan.tickets.length} tickets, the limit is ${maxTickets}`);

  const keys = new Set<string>();
  for (const t of plan.tickets) {
    if (keys.has(t.key)) errors.push(`tickets: duplicate key "${t.key}"`);
    keys.add(t.key);
  }
  for (const t of plan.tickets) {
    for (const d of t.depends_on) {
      if (d === t.key) errors.push(`tickets.${t.key}.depends_on: depends on itself`);
      else if (!keys.has(d)) errors.push(`tickets.${t.key}.depends_on: unknown key "${d}"`);
    }
  }
  if (errors.length) return { errors };

  const apart = stackApartOverlaps(plan.tickets.map((t) => ({ key: t.key, dependsOn: t.depends_on, touches: t.touches ?? [] })));
  if (!apart) return { errors: ['tickets: depends_on contains a cycle'] };
  const { stacked: stackedDeps, needs } = apart;
  const order = topoOrder(stackedDeps)!;
  const lineParent = new Map(order.map((o, i) => [o.key, i ? [order[i - 1].key] : []]));
  const stacked = plan.tickets.map((t, i) => ({ ...t, depends_on: opts.line ? lineParent.get(t.key)! : stackedDeps[i].dependsOn }));
  return { plan, stacked, needs: new Map(needs.map((n) => [n.key, n.dependsOn])), order, errors: [] };
}

const GENERATED = 'generated:';

function normalizedTouch(p: string): string | null {
  const t = p.trim().replace(/^\.\//, '');
  return !t || t.startsWith(GENERATED) ? null : t;
}

/** Two write sets overlap when they name the same file, or one names a folder the other's file is in. */
export function touchesOverlap(a: string[], b: string[]): string[] {
  const left = a.map(normalizedTouch).filter((p): p is string => !!p);
  const right = b.map(normalizedTouch).filter((p): p is string => !!p);
  const covers = (dir: string, p: string) => dir.endsWith('/') && p.startsWith(dir);
  return left.filter((x) => right.some((y) => x === y || covers(x, y) || covers(y, x)));
}

type Touching = Dependent & { touches: string[] };

function stackApartOverlaps<T extends Touching>(items: T[]): { stacked: T[]; needs: T[] } | null {
  let current = items;
  for (;;) {
    const stacked = stackDependencies(current);
    if (!stacked) return null;
    const parentOf = (key: string) => stacked.find((s) => s.key === key)!.dependsOn[0] ?? null;
    const isBelow = (low: string, high: string): boolean => {
      for (let p = parentOf(high); p; p = parentOf(p)) if (p === low) return true;
      return false;
    };
    const order = topoOrder(stacked)!.map((o) => o.key);
    const clash = order
      .flatMap((later, i) => order.slice(0, i).map((earlier) => ({ earlier, later })))
      .find(({ earlier, later }) => !isBelow(earlier, later) && touchesOverlap(touchesOf(items, earlier), touchesOf(items, later)).length > 0);
    if (!clash) return { stacked, needs: current };
    current = current.map((t) => {
      if (t.key !== clash.later) return t;
      if (t.dependsOn.includes(clash.earlier)) throw new Error(`overlap stacking made no progress for ${clash.earlier} and ${clash.later}`);
      return { ...t, dependsOn: [...t.dependsOn, clash.earlier] };
    });
  }
}

const touchesOf = (items: Touching[], key: string) => items.find((t) => t.key === key)!.touches;

type Dependent = { key: string; dependsOn: string[] };

/**
 * Turns what each ticket needs into the one ticket it stacks on: its branch starts from that
 * ticket's branch and its PR targets it. A need that another need already brings is dropped, so
 * tickets that need the same ticket stack on it side by side and build in parallel. A branch has
 * one base, so when a ticket needs two tickets that don't build on each other, those two go into
 * one line, the later one in plan order on top of the earlier. Null when the needs have a cycle.
 */
export function stackDependencies<T extends Dependent>(items: T[]): T[] | null {
  const order = topoOrder(items);
  if (!order) return null;
  const rank = new Map(order.map((o, i) => [o.key, i]));
  const needs = new Map(items.map((t) => [t.key, new Set(t.dependsOn)]));
  const ancestors = (key: string, seen = new Set<string>()): Set<string> => {
    for (const d of needs.get(key) ?? []) {
      if (seen.has(d)) continue;
      seen.add(d);
      ancestors(d, seen);
    }
    return seen;
  };
  const direct = (key: string): string[] => {
    const all = [...needs.get(key)!];
    return all.filter((d) => !all.some((o) => o !== d && ancestors(o).has(d))).sort((a, b) => rank.get(a)! - rank.get(b)!);
  };
  // Every added edge points from an earlier ticket to a later one in `order`, so no cycle can form,
  // and each round adds an edge that wasn't there, so this ends.
  for (;;) {
    const shared = order.map((o) => direct(o.key)).find((d) => d.length > 1);
    if (!shared) break;
    for (let i = 1; i < shared.length; i++) needs.get(shared[i])!.add(shared[i - 1]);
  }
  return items.map((t) => ({ ...t, dependsOn: direct(t.key) }));
}

export interface StackShape {
  /** The most tickets one line holds, bottom to top. */
  longest: string[];
  /** The most tickets that can build at the same time (tickets in one wave). */
  widest: number;
  /** Tickets that stack on one they don't need, because a later ticket needs both. */
  forced: { key: string; on: string }[];
}

export function stackShape(needs: Dependent[], stacked: Dependent[]): StackShape {
  const parentOf = new Map(stacked.map((t) => [t.key, t.dependsOn[0] ?? null]));
  const line = (key: string): string[] => {
    const parent = parentOf.get(key);
    return parent ? [...line(parent), key] : [key];
  };
  const longest = stacked.map((t) => line(t.key)).reduce<string[]>((a, b) => (b.length > a.length ? b : a), []);
  const waves = new Map<number, number>();
  for (const t of stacked) waves.set(line(t.key).length, (waves.get(line(t.key).length) ?? 0) + 1);
  const needsOf = new Map(needs.map((t) => [t.key, t.dependsOn]));
  const reaches = (key: string, target: string): boolean => (needsOf.get(key) ?? []).some((d) => d === target || reaches(d, target));
  const forced = stacked.filter((t) => t.dependsOn[0] && !reaches(t.key, t.dependsOn[0])).map((t) => ({ key: t.key, on: t.dependsOn[0] }));
  return { longest, widest: Math.max(0, ...waves.values()), forced };
}

/** Tickets that stack on the same ticket beside an earlier one: a GitHub stack is one line, so their PRs sit outside it. */
export function outsideGithubStack(stacked: Dependent[]): string[] {
  const seen = new Set<string>();
  return stacked.filter((t) => {
    const parent = t.dependsOn[0];
    if (!parent) return false;
    if (seen.has(parent)) return true;
    seen.add(parent);
    return false;
  }).map((t) => t.key);
}

/** Files in the write sets of three or more tickets: each one lines those tickets up, one after another. */
export function sharedHotspots(tickets: { key: string; touches?: string[] }[]): { path: string; keys: string[] }[] {
  const byPath = new Map<string, string[]>();
  for (const t of tickets) for (const p of new Set((t.touches ?? []).map(normalizedTouch).filter((x): x is string => !!x))) byPath.set(p, [...(byPath.get(p) ?? []), t.key]);
  return [...byPath].filter(([, keys]) => keys.length >= 3).map(([path, keys]) => ({ path, keys })).sort((a, b) => b.keys.length - a.keys.length);
}

export function renderStacking(needs: (Dependent & { touches?: string[] })[], stacked: Dependent[], concurrency: number, opts: { line?: boolean } = {}): string {
  const shape = stackShape(needs, stacked);
  const outside = opts.line ? [] : outsideGithubStack(stacked);
  const unstated = needs.filter((t) => !t.touches?.length).map((t) => t.key);
  const hotspots = sharedHotspots(needs);
  return [
    '# How the factory will build these tickets',
    '',
    "Each ticket's branch and PR sit on the one ticket it stacks on, and it starts once that ticket is built and pushed. Tickets that stack on the same ticket build at the same time.",
    '',
    ...stacked.map((t) => `- ${t.key}: ${t.dependsOn[0] ? `on ${t.dependsOn[0]}` : 'on the base branch'}`),
    '',
    `Longest line: ${shape.longest.length} ticket${shape.longest.length === 1 ? '' : 's'} (${shape.longest.join(' → ')}).`,
    `Most at once: ${shape.widest} ticket${shape.widest === 1 ? '' : 's'}; this initiative runs up to ${concurrency} tickets at a time.`,
    ...(shape.forced.length
      ? [
          '',
          'Stacked on a ticket they do not need, because a later ticket needs both, a branch has one base, or the two touch the same files:',
          ...shape.forced.map((f) => `- ${f.key} on ${f.on}`),
        ]
      : []),
    ...(opts.line ? ['', 'Every PR joins one GitHub stack in plan order; tickets still build side by side when what they need is ready.'] : []),
    ...(outside.length
      ? ['', `A GitHub stack is a single line, so these PRs will sit outside it (and skip CI that runs only for the stack): ${outside.join(', ')}.`]
      : []),
    ...(hotspots.length
      ? [, 'Shared hotspots, files three or more tickets change, so those tickets build one after another; a foundation ticket that makes the shared change first lets the rest build side by side:', ...hotspots.map((h) => `- ${h.path}: ${h.keys.join(', ')}`)]
      : []),
    ...(unstated.length ? ['', `No \`touches\` (write set) given for: ${unstated.join(', ')}. Without it the factory cannot keep side-by-side tickets out of each other's files.`] : []),
  ].join('\n');
}

export function topoOrder(items: Dependent[]): OrderedTicket[] | null {
  const index = new Map(items.map((t, i) => [t.key, i]));
  const remaining = new Map(items.map((t) => [t.key, new Set(t.dependsOn)]));
  const wave = new Map<string, number>();
  const out: OrderedTicket[] = [];
  while (remaining.size) {
    const ready = [...remaining.entries()]
      .filter(([, deps]) => deps.size === 0)
      .map(([k]) => k)
      .sort((a, b) => index.get(a)! - index.get(b)!);
    if (!ready.length) return null;
    const next = ready[0];
    const item = items[index.get(next)!];
    const w = item.dependsOn.length ? Math.max(...item.dependsOn.map((d) => wave.get(d)! + 1)) : 0;
    wave.set(next, w);
    out.push({ key: next, seq: out.length + 1, wave: w });
    remaining.delete(next);
    for (const deps of remaining.values()) deps.delete(next);
  }
  return out;
}

export function firstLine(md: string | null | undefined): string | null {
  if (!md) return null;
  const line = md.split('\n').find((l) => l.trim());
  return line ? line.trim().replace(/^#+\s*/, '') : null;
}

export function section(md: string, heading: string): string | null {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
  const m = re.exec(md);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  const end = rest.search(/^##\s+/m);
  return (end === -1 ? rest : rest.slice(0, end)).trim() || null;
}

export function slugify(s: string, max = 40): string {
  const full = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (full.length <= max) return full || 'item';
  const cut = full.slice(0, max + 1);
  const dash = cut.lastIndexOf('-');
  return (dash > max / 2 ? cut.slice(0, dash) : full.slice(0, max)).replace(/-+$/g, '') || 'item';
}

export interface MissingPath {
  ticket: string;
  path: string;
}

function pathToken(token: string): string | null {
  const t = token.trim().replace(/:\d+(-\d+)?$/, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /[\s<>{}*?[\]]/.test(t) || /^[/~]/.test(t) || !t.includes('/')) return null;
  return t.endsWith('/') || /\.[a-z0-9]+$/i.test(t) ? t.replace(/^\.\//, '') : null;
}

export function missingPlanPaths(plan: PlanJson, tracked: string[]): MissingPath[] {
  const files = new Set(tracked);
  const out: MissingPath[] = [];
  for (const t of plan.tickets) {
    const seen = new Set<string>();
    for (const g of t.guidance) {
      for (const m of g.matchAll(/`([^`\n]+)`/g)) {
        const p = pathToken(m[1]);
        if (!p || seen.has(p)) continue;
        seen.add(p);
        const dir = p.replace(/\/$/, '');
        if (!files.has(dir) && !tracked.some((f) => f.startsWith(`${dir}/`))) out.push({ ticket: t.key, path: p });
      }
    }
  }
  return out;
}

export function renderPlanPaths(missing: MissingPath[]): string {
  return [
    '# Paths the plan names that do not exist at the base',
    '',
    ...missing.map((m) => `- ${m.ticket}: \`${m.path}\``),
    '',
    'A path the ticket itself creates is fine; anything else is probably a wrong name.',
  ].join('\n');
}

export function renderPlanContext(plan: PlanJson): string {
  const list = (items: string[]) => items.map((b) => `- ${b}`).join('\n');
  return [
    '# Initiative context',
    '',
    '## Goal',
    plan.goal,
    '',
    '## Success criteria',
    list(plan.success_criteria),
    '',
    '## Definition of done',
    list(plan.definition_of_done),
    ...(plan.edge_cases.length ? ['', '## Edge cases', list(plan.edge_cases)] : []),
  ].join('\n');
}
