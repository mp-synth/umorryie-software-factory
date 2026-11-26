import type { Ticket, TicketStatus } from '@factory/shared';

type Dependency = Pick<Ticket, 'status' | 'prNumber' | 'prState' | 'ciState'> & Partial<Pick<Ticket, 'foundation'>> & {
  /** Whether its latest gate passed on the head its PR shows; undefined when the caller did not look. */
  gatePassedAtHead?: boolean;
};

export interface ReadinessRules {
  waitForCi: boolean;
  startWhenBuilt: boolean;
  foundationCheckpoint?: boolean;
}

// A ticket being fixed, checked again or sent back by its review is about to change: nothing builds on it then.
const SETTLED_AND_BUILT: TicketStatus[] = ['built', 'in_review', 'approved'];

export const hasOpenPr = (t: Pick<Ticket, 'prNumber' | 'prState'>) => !!t.prNumber && t.prState === 'OPEN';

const ciGreen = (t: Dependency) => !hasOpenPr(t) || t.ciState === 'green' || t.ciState === 'none';
const foundationCiGreen = (t: Dependency) => !hasOpenPr(t) || t.ciState === 'green';

/**
 * Whether a ticket stacked on `dep` may start, or take a fix. An approved or merged ticket counts. With
 * `startWhenBuilt`, so does a built one whose PR is open and whose checks passed on the head it pushed: the
 * ticket on it starts from that pushed branch. A foundation waits until it is approved and green.
 */
export function dependencyReady(dep: Dependency, rules: ReadinessRules): boolean {
  if (dep.status === 'merged') return true;
  if (rules.foundationCheckpoint && dep.foundation) return dep.status === 'approved' && foundationCiGreen(dep) && dep.gatePassedAtHead !== false;
  const built = rules.startWhenBuilt && hasOpenPr(dep) && SETTLED_AND_BUILT.includes(dep.status) && dep.gatePassedAtHead !== false;
  if (dep.status !== 'approved' && !built) return false;
  return !rules.waitForCi || ciGreen(dep);
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

type GateRun = { kind: string; verdict: string | null; headSha?: string | null; gatePurpose?: string | null; prompt?: string | null };

export type GateRequirement = 'checks' | 'merge';

/**
 * Whether the latest relevant gate among `runs` (newest first) passed on `head`. Full checks never trust the
 * lighter merge command used by sync gates; merge safety may trust either. A gate that could not finish
 * (INFRA) says nothing either way and is passed over.
 */
export function passedGateAt(runs: GateRun[], head: string, requirement: GateRequirement = 'checks', checksCommand?: string | null): boolean {
  const gate = runs.find(
    (r) =>
      r.kind === 'gate' &&
      r.verdict !== 'GATE: INFRA' &&
      (requirement === 'merge' || r.gatePurpose !== 'sync' || (!!checksCommand && r.prompt === checksCommand)),
  );
  return gate?.verdict === 'GATE: PASS' && gate.headSha === head;
}
