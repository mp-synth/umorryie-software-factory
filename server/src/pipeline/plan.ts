import { z } from 'zod';
import type { PlanJson } from '@factory/shared';

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

export function validatePlan(raw: unknown, maxTickets: number): { plan?: PlanJson; order?: OrderedTicket[]; errors: string[] } {
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

  const order = topoOrder(plan.tickets.map((t) => ({ key: t.key, dependsOn: t.depends_on })));
  if (!order) return { errors: ['tickets: depends_on contains a cycle'] };
  return { plan, order, errors: [] };
}

export function topoOrder(items: { key: string; dependsOn: string[] }[]): OrderedTicket[] | null {
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
