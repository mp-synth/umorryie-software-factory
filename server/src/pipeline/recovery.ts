import type { Initiative, Run, RunKind, Ticket } from '@factory/shared';

export const INTERRUPTED_REASON = 'Interrupted when the factory server stopped.';
export const ORPHAN_REASON = 'Left mid-step when the factory server stopped.';

export function restingTicketStatus(kind: RunKind, hasBranch: boolean, failed: boolean): Ticket['status'] {
  if (failed) return 'blocked';
  const resting: Partial<Record<RunKind, Ticket['status']>> = {
    execute: hasBranch ? 'blocked' : 'todo',
    gate: 'built',
    review: 'built',
    fix: 'changes_requested',
    verify: 'built',
  };
  return resting[kind] ?? 'todo';
}

export function restingInitiativeStatus(kind: RunKind, hasPlan: boolean, failed: boolean): Initiative['status'] {
  if (hasPlan) return 'awaiting_approval';
  return kind === 'plan' && failed ? 'failed' : 'draft';
}

export function orphanRunKind(status: Ticket['status'] | Initiative['status']): RunKind | null {
  const kinds: Partial<Record<string, RunKind>> = {
    building: 'execute',
    checking: 'gate',
    in_review: 'review',
    fixing: 'fix',
    planning: 'plan',
    plan_review: 'plan_review',
  };
  return kinds[status] ?? null;
}

export const ORPHAN_INITIATIVE_STATUSES: Initiative['status'][] = ['planning', 'plan_review'];

const ts = (x: string): number => new Date(x).getTime();

export function shouldResumeInterrupted(opts: { run: Run; earlier: Run[]; enabled: boolean; sweepOwned: boolean }): boolean {
  const { run, earlier, enabled, sweepOwned } = opts;
  if (!enabled || run.kind === 'ask') return false;
  if (run.kind === 'fix' && sweepOwned) return false;
  const sameStep = (r: Run) => r.kind === run.kind && r.ticketId === run.ticketId && r.initiativeId === run.initiativeId;
  const lastSucceeded = Math.max(0, ...earlier.filter((r) => sameStep(r) && r.status === 'succeeded').map((r) => ts(r.queuedAt)));
  return !earlier.some(
    (r) => r.id !== run.id && r.status === 'interrupted' && sameStep(r) && r.round === run.round && ts(r.queuedAt) > lastSucceeded,
  );
}
