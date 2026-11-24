import {
  Bot,
  BrainCircuit,
  GraduationCap,
  CheckCircle2,
  ClipboardCheck,
  Hammer,
  MessageCircleQuestion,
  Route,
  Scale,
  ScanSearch,
  ShieldCheck,
  UserCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { InitiativeStatus, RunKind, RunStatus, TicketStatus } from '@factory/shared';

export type Tone = 'neutral' | 'active' | 'attention' | 'success' | 'danger' | 'muted' | 'accent' | 'info';

export const toneClasses: Record<Tone, { pill: string; dot: string; text: string; bar: string }> = {
  neutral: { pill: 'bg-zinc-500/10 text-zinc-300 ring-zinc-500/20', dot: 'bg-zinc-400', text: 'text-zinc-300', bar: 'bg-zinc-500' },
  muted: { pill: 'bg-zinc-500/5 text-zinc-500 ring-zinc-500/15', dot: 'bg-zinc-600', text: 'text-zinc-500', bar: 'bg-zinc-700' },
  active: { pill: 'bg-cyan-400/10 text-cyan-300 ring-cyan-400/25', dot: 'bg-cyan-400', text: 'text-cyan-300', bar: 'bg-cyan-400' },
  info: { pill: 'bg-sky-400/10 text-sky-300 ring-sky-400/20', dot: 'bg-sky-400', text: 'text-sky-300', bar: 'bg-sky-500' },
  attention: { pill: 'bg-amber-400/10 text-amber-300 ring-amber-400/25', dot: 'bg-amber-400', text: 'text-amber-300', bar: 'bg-amber-400' },
  success: { pill: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25', dot: 'bg-emerald-400', text: 'text-emerald-300', bar: 'bg-emerald-400' },
  danger: { pill: 'bg-rose-500/10 text-rose-300 ring-rose-500/25', dot: 'bg-rose-400', text: 'text-rose-300', bar: 'bg-rose-500' },
  accent: { pill: 'bg-violet-400/10 text-violet-300 ring-violet-400/25', dot: 'bg-violet-400', text: 'text-violet-300', bar: 'bg-violet-400' },
};

export const initiativeStatus: Record<InitiativeStatus, { label: string; tone: Tone; live?: boolean }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  planning: { label: 'Planning', tone: 'active', live: true },
  plan_review: { label: 'Reviewing plan', tone: 'active', live: true },
  needs_input: { label: 'Needs your input', tone: 'attention' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'attention' },
  in_progress: { label: 'Building', tone: 'accent' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  archived: { label: 'Archived', tone: 'muted' },
};

export const ticketStatus: Record<TicketStatus, { label: string; tone: Tone; live?: boolean }> = {
  proposed: { label: 'Proposed', tone: 'muted' },
  todo: { label: 'To do', tone: 'neutral' },
  building: { label: 'Building', tone: 'active', live: true },
  checking: { label: 'Running checks', tone: 'active', live: true },
  built: { label: 'Built', tone: 'info' },
  in_review: { label: 'In review', tone: 'active', live: true },
  changes_requested: { label: 'Changes requested', tone: 'attention' },
  fixing: { label: 'Fixing', tone: 'active', live: true },
  approved: { label: 'Approved', tone: 'success' },
  merged: { label: 'Merged', tone: 'success' },
  blocked: { label: 'Needs you', tone: 'danger' },
  canceled: { label: 'Canceled', tone: 'muted' },
};

export const runStatus: Record<RunStatus, { label: string; tone: Tone; live?: boolean }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'active', live: true },
  succeeded: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  canceled: { label: 'Canceled', tone: 'muted' },
  interrupted: { label: 'Interrupted', tone: 'attention' },
};

export const runKind: Record<RunKind, { label: string; agent: string; icon: LucideIcon; color: string }> = {
  plan: { label: 'Plan', agent: 'Planner', icon: BrainCircuit, color: 'text-violet-300' },
  plan_review: { label: 'Plan review', agent: 'Plan reviewer', icon: ClipboardCheck, color: 'text-indigo-300' },
  execute: { label: 'Build', agent: 'Executor', icon: Hammer, color: 'text-cyan-300' },
  gate: { label: 'Checks', agent: 'Checks gate', icon: ShieldCheck, color: 'text-teal-300' },
  review: { label: 'Review', agent: 'Reviewer', icon: ScanSearch, color: 'text-sky-300' },
  fix: { label: 'Fix', agent: 'Fixer', icon: Wrench, color: 'text-amber-300' },
  verify: { label: 'Verify fix', agent: 'Fix verifier', icon: UserCheck, color: 'text-lime-300' },
  arbitrate: { label: 'Decide', agent: 'Arbiter', icon: Scale, color: 'text-orange-300' },
  ask: { label: 'Ask', agent: 'Advisor', icon: MessageCircleQuestion, color: 'text-fuchsia-300' },
  steer: { label: 'Route feedback', agent: 'Steering router', icon: Route, color: 'text-rose-300' },
  retro: { label: 'Retro', agent: 'Retro', icon: GraduationCap, color: 'text-emerald-300' },
};

export const AgentIcon = Bot;
export const DoneIcon = CheckCircle2;

export function verdictTone(v: string | null | undefined): Tone {
  if (!v) return 'muted';
  if (/APPROVE|PASS|READY|APPLIED|SKIPPED/i.test(v)) return /SKIPPED/i.test(v) ? 'neutral' : 'success';
  if (/CHANGES|REVISE|NO-CHANGES|NOTHING|RETRY/i.test(v)) return 'attention';
  if (/BLOCK|FAIL|ESCALATE/i.test(v)) return 'danger';
  return 'neutral';
}

export function shortVerdict(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.replace(/^(VERDICT|STATUS|PLAN|FIX|GATE|DECISION|ROUTE|RETRO):\s*/i, '').split(/\s+·\s+/)[0].slice(0, 28);
}

export const isRunInFlight = (r: { status: RunStatus }): boolean => r.status === 'running' || r.status === 'queued';

export const isArbitrating = (runs: { kind: RunKind; status: RunStatus }[]): boolean => runs.some((r) => r.kind === 'arbitrate' && isRunInFlight(r));

type ReplaceableRun = { id: string; kind: RunKind; status: RunStatus; ticketId: string | null; queuedAt: string; startedAt: string | null };

/** Ids of failed or interrupted runs that a later run of the same agent, on the same ticket, has replaced. */
export function replacedRunIds(runs: ReplaceableRun[]): Set<string> {
  const scope = (r: ReplaceableRun) => `${r.ticketId ?? ''}:${r.kind}`;
  const at = (r: ReplaceableRun) => Date.parse(r.startedAt ?? r.queuedAt);
  const latest = new Map<string, number>();
  for (const r of runs) latest.set(scope(r), Math.max(latest.get(scope(r)) ?? -Infinity, at(r)));
  return new Set(runs.filter((r) => (r.status === 'failed' || r.status === 'interrupted') && latest.get(scope(r))! > at(r)).map((r) => r.id));
}

export const isNotArchived = (i: { status: InitiativeStatus }): boolean => i.status !== 'archived';

export const findSucceededRun = <R extends { kind: RunKind; status: RunStatus }>(runs: R[], kind: RunKind): R | undefined =>
  runs.find((r) => r.kind === kind && r.status === 'succeeded');
