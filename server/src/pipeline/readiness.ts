import type { Ticket, TicketStatus } from '@factory/shared';

type Dependency = Pick<Ticket, 'status' | 'prNumber' | 'prState' | 'ciState'>;

export interface ReadinessRules {
  waitForCi: boolean;
  startWhenBuilt: boolean;
}

// Statuses a ticket can hold after its first checks passed and its branch was pushed.
const BUILT: TicketStatus[] = ['checking', 'built', 'in_review', 'changes_requested', 'fixing', 'approved'];

export const hasOpenPr = (t: Pick<Ticket, 'prNumber' | 'prState'>) => !!t.prNumber && t.prState === 'OPEN';

/**
 * Whether a ticket stacked on `dep` may start. An approved or merged ticket always counts. With
 * `startWhenBuilt`, so does a built one whose PR is open: the ticket on it starts from that pushed
 * branch, and stack sync merges every later fix of it into the PR on top.
 */
export function dependencyReady(dep: Dependency, rules: ReadinessRules): boolean {
  if (dep.status === 'merged') return true;
  const built = rules.startWhenBuilt && hasOpenPr(dep) && BUILT.includes(dep.status);
  if (dep.status !== 'approved' && !built) return false;
  if (!rules.waitForCi || !hasOpenPr(dep)) return true;
  return dep.ciState === 'green' || dep.ciState === 'none';
}

/**
 * A ticket that started on a built ticket is reviewed only once the ticket below is approved (or
 * merged, or gone), so its review reads it on top of the code that will merge under it. Returns
 * the ticket the review waits for, or null. `below` is the ticket it stacks on, merged and
 * canceled ones skipped.
 */
export function reviewWaitsFor<T extends Pick<Ticket, 'status' | 'lastVerdict'>>(ticket: T, below: T | null, startWhenBuilt: boolean): T | null {
  if (!startWhenBuilt || !below || ticket.lastVerdict !== null) return null;
  return below.status === 'approved' ? null : below;
}
