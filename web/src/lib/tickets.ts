import { SETTLED_TICKET_STATUSES, type PrSweepSkip, type Run, type Ticket } from '@factory/shared';
import type { TicketAction } from './api';
import { SHIPPED } from './initiative';
import { isArbitrating } from './status';

/** The ticket's own next step, offered as its one visible button; everything else lives in its menu. */
export type PrimaryTicketAction = { kind: 'watch'; label: string; runId: string } | { kind: 'act'; label: string; action: TicketAction };

export function primaryTicketAction(t: Ticket, { approved, activeRun, waitingOn }: { approved: boolean; activeRun?: Run; waitingOn: Ticket[] }): PrimaryTicketAction | null {
  if (activeRun) return { kind: 'watch', label: 'Watch', runId: activeRun.id };
  if (!approved) return null;
  switch (t.status) {
    case 'todo':
      return waitingOn.length ? null : { kind: 'act', label: 'Build', action: 'run' };
    case 'built':
      return { kind: 'act', label: 'Review', action: 'review' };
    case 'changes_requested':
      return { kind: 'act', label: 'Fix', action: 'fix' };
    case 'blocked':
      if (t.branch && (t.gateStatus === 'fail' || t.gateStatus === 'infra' || t.gateStatus === 'waiting')) {
        return { kind: 'act', label: 'Re-run checks', action: 'check' };
      }
      return t.branch ? { kind: 'act', label: 'Fix', action: 'fix' } : { kind: 'act', label: 'Retry build', action: 'run' };
    default:
      return null;
  }
}

/** Dependencies a ticket still waits for: not shipped and not even built on a branch yet. */
export function dependenciesOf(t: Ticket, all: Ticket[]): { deps: Ticket[]; waitingOn: Ticket[] } {
  const deps = t.dependsOn.map((k) => all.find((x) => x.key === k)).filter((x): x is Ticket => !!x);
  return { deps, waitingOn: deps.filter((d) => !SHIPPED.includes(d.status) && !d.branch) };
}

export type TicketFilter = 'all' | 'needs-you' | 'in-flight' | 'waiting' | 'done' | 'canceled';

/** "All" leaves out canceled tickets: a revised plan dropped them, so they only show under their own filter. */
export const TICKET_FILTERS: { value: TicketFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs-you', label: 'Needs you' },
  { value: 'in-flight', label: 'In flight' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
  { value: 'canceled', label: 'Canceled' },
];

export function ticketFilterOf(t: Ticket, runs: Run[]): Exclude<TicketFilter, 'all'> {
  if (t.status === 'canceled') return 'canceled';
  if (t.status === 'blocked' && !isArbitrating(runs.filter((r) => r.ticketId === t.id))) return 'needs-you';
  if (['building', 'checking', 'in_review', 'fixing', 'blocked'].includes(t.status)) return 'in-flight';
  if (SHIPPED.includes(t.status)) return 'done';
  return 'waiting';
}

/** The PR sweep's last reason for leaving this PR alone, while the PR is still one it sweeps and nothing is fixing it. */
export function sweepSkipOf(t: Ticket, activeRun: Run | undefined): PrSweepSkip | null {
  const skip = t.prSweepSkip;
  if (!skip?.reason || activeRun || t.prSweepClaimedAt || t.prState !== 'OPEN' || !SETTLED_TICKET_STATUSES.includes(t.status)) return null;
  return skip;
}

export function sweepSkipLabel(skip: PrSweepSkip): string {
  if (skip.reason === 'already-tried') return 'fixer already tried';
  if (skip.reason === 'ci-running') return 'waiting for CI';
  if (skip.reason === 'merge-unknown') return 'checking mergeability';
  if (skip.reason === 'inherited') return 'fails on its base too';
  if (skip.reason === 'rerun') return 're-ran a flaky check';
  if (skip.reason === 'stack-below') return 'waiting on the PR below';
  if (skip.reason === 'waiting-on') return 'waiting on people or external work';
  return skip.waitingOn.length ? 'waiting on people' : 'nothing to fix';
}

export const TICKET_ACTION_TOASTS: Record<TicketAction, string> = {
  run: 'Executor queued',
  check: 'Checks queued',
  review: 'Reviewer queued',
  fix: 'Fixer queued',
  retro: 'Retro queued: it proposes rules under Learned rules',
  reset: 'Ticket reset',
  'mark-approved': 'Marked approved',
  'mark-merged': 'Marked merged',
  'mark-todo': 'Moved back to to-do',
};
