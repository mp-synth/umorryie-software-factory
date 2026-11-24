import type { Ticket } from '@factory/shared';
import type { PrCi } from '../github.ts';

/** How often open factory PRs whose CI is still running are checked, between the 5-minute PR syncs. */
export const CI_POLL_MS = 60_000;

type CiSnapshot = Pick<PrCi, 'failingChecks' | 'pendingChecks' | 'headRefOid'>;

/** Right after a push GitHub may list no checks yet; `none` is polled this long before it counts as a PR without CI. */
const NO_CHECKS_YET_MS = 10 * 60_000;
/** CI still pending this long after the head last changed is stuck; the 5-minute PR sync still sees it finish. */
const PENDING_POLL_CAP_MS = 2 * 60 * 60_000;

/** Remembers when each ticket's PR was first seen at its current head, so stuck CI stops being polled. */
export class CiHeadsSeen {
  private seen = new Map<string, { head: string | null; at: number }>();

  since(ticketId: string, head: string | null | undefined, now = Date.now()): number {
    const s = this.seen.get(ticketId);
    if (s && s.head === (head ?? null)) return s.at;
    this.seen.set(ticketId, { head: head ?? null, at: now });
    return now;
  }
}

/**
 * A PR is worth checking every minute while its CI can still change the next step: running (for up
 * to two hours at one head), not yet reported, or red at a commit whose settled failure has not been
 * handed to the PR sweep yet.
 */
export function ciWorthPolling(
  ticket: Pick<Ticket, 'ciState' | 'ciHeadSha' | 'updatedAt'>,
  handedOverSha: string | undefined,
  headSeenAt: number,
  now = Date.now(),
): boolean {
  if (ticket.ciState == null) return true;
  if (ticket.ciState === 'pending') return now - headSeenAt < PENDING_POLL_CAP_MS;
  if (ticket.ciState === 'none') return now - new Date(ticket.updatedAt).getTime() < NO_CHECKS_YET_MS;
  return ticket.ciState === 'red' && (!ticket.ciHeadSha || ticket.ciHeadSha !== handedOverSha);
}

/**
 * CI has finished red at this head: some check failed and none is still running. Only then does the
 * poll hand the PR to the sweep early, so the fixer sees the same set of failures the 15-minute sweep
 * would have shown it, just sooner. Each head commit is handed over once.
 */
export function ciSettledRed(snap: CiSnapshot, handedOverSha: string | undefined): boolean {
  return snap.failingChecks.length > 0 && snap.pendingChecks.length === 0 && snap.headRefOid !== handedOverSha;
}
