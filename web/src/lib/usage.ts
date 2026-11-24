import { MODEL_VERSIONS } from '@factory/shared';
import { runKind } from './status';

// Usage weeks run Monday 00:00 UTC to the next Monday, the way billing dashboards count them.

const DAY_MS = 86_400_000;

export function weekStartUtc(at: Date = new Date()): Date {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY_MS);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** "Mon 24" (short) or "Monday 24 Nov" (long) for a UTC day key like 2026-11-24. */
export function dayName(key: string, style: 'short' | 'long' = 'short'): string {
  const d = new Date(`${key}T00:00:00Z`);
  const weekday = d.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: style === 'long' ? 'long' : 'short' });
  const date = d.toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', ...(style === 'long' ? { month: 'short' } : {}) });
  return `${weekday} ${date}`;
}

export function weekLabel(start: Date): string {
  const end = addDays(start, 6);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}

const MODEL_LABELS: Record<string, string> = Object.fromEntries(Object.values(MODEL_VERSIONS).map((m) => [m.id, m.label]));

export function modelLabel(id: string | null): string {
  if (!id) return 'Unknown';
  return MODEL_LABELS[id] ?? id.replace(/^claude-/, '');
}

const EXTRA_KINDS: Record<string, string> = { discovery: 'Project discovery', eval: 'Judge evals', notion_fetch: 'Notion pages', other: 'Other' };

export function kindLabel(kind: string): string {
  return runKind[kind as keyof typeof runKind]?.label ?? EXTRA_KINDS[kind] ?? kind.replace(/_/g, ' ');
}
