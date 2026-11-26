import type { PrSweepSkipReason } from '@factory/shared';
import { hasPrWork, prWorkFingerprint, withoutInherited, type PrWork } from './pr-work.ts';

export interface SweepFacts {
  work: PrWork;
  /** A fixer already had the PR in exactly this state. */
  alreadyTried?: boolean;
  /** The persisted fingerprint to compare after inherited failures and stale conflicts are removed. */
  previousFingerprint?: string | null;
  /** Failing checks that fail the same way where the PR's base is (the base branch, or the PR below). */
  inheritedChecks: string[];
  /** Failing checks whose failures are outside the PR's changes, on a first attempt: one re-run tells a flake apart. */
  flakyRuns: { name: string; runId: string }[];
  /** What a local merge of the PR's base said: false means GitHub's "conflicting" is stale. Null when not checked. */
  conflictConfirmed: boolean | null;
  /** The project has a checks command, so the server can repair by script before any agent. */
  canRepair: boolean;
  /** The lowest PR below that is not ready yet, when there is one: CI here likely fails because of it. */
  unreadyBelow: string | null;
}

export type SweepAction =
  | { kind: 'skip'; reason: PrSweepSkipReason; why: string; work: PrWork }
  | { kind: 'rerun'; runs: { name: string; runId: string }[]; work: PrWork }
  | { kind: 'repair'; work: PrWork }
  | { kind: 'fix'; work: PrWork };

export const sweepWorkFingerprint = (work: PrWork): string => prWorkFingerprint(work);
export const sweepDecisionFingerprint = (decision: Pick<SweepAction, 'work'>): string => sweepWorkFingerprint(decision.work);

const hasHumanItems = (w: PrWork) => w.threads.length > 0 || w.comments.length > 0 || w.reviews.length > 0;
const names = (checks: { name: string }[]) => checks.map((c) => c.name).join(', ');

/**
 * What the PR sweep does with one open PR, decided from facts the server already read, so no agent starts for
 * work a rule can settle: waiting on the PR below or on CI, failures that are not the PR's, a flake worth one
 * re-run, a conflict GitHub has not re-checked. Deterministic failures go to a script repair first; an agent
 * starts only for review threads and comments, or when no repair is possible.
 */
export function decideSweep(f: SweepFacts): SweepAction {
  const skip = (reason: PrSweepSkipReason, why: string, work = f.work): SweepAction => ({ kind: 'skip', reason, why, work });
  if (f.unreadyBelow && (f.work.failingChecks.length || f.work.conflicting)) {
    return skip('stack-below', `${f.unreadyBelow} below this PR is not ready yet; its CI and conflicts are looked at again once its code is in this branch.`);
  }
  const pending = f.work.snap.pendingChecks.length;
  if (pending && (f.work.ciStillRunning || hasHumanItems(f.work))) {
    return skip('ci-running', `${pending} check${pending === 1 ? '' : 's'} still run; the sweep waits until CI and bot reviewers are done, so one fixer takes everything at once.`);
  }
  let work = withoutInherited(f.work, f.inheritedChecks);
  if (work.conflicting && f.conflictConfirmed === false) {
    work = { ...work, conflicting: false, ignored: [...work.ignored, "GitHub's merge conflict: the PR merges cleanly with its base when merged here; GitHub has not re-checked yet"] };
  }
  if (!hasPrWork(work)) {
    if (f.inheritedChecks.length) return skip('inherited', `Every failing check (${f.inheritedChecks.join(', ')}) fails the same way where the PR's base is; it is fixed there, not here.`, work);
    if (work.waitingOn.length) return skip('waiting-on', `Nothing for a fixer: what still fails waits on people or on work outside this repo.`, work);
    return skip(work.snap.pendingChecks.length ? 'ci-running' : 'idle', 'Nothing for a fixer: no failing check it can fix, no conflict, no review thread or comment to answer.', work);
  }
  const flaky = f.flakyRuns.filter((r) => work.failingChecks.some((c) => c.name === r.name));
  if (!hasHumanItems(work) && !work.conflicting && flaky.length === work.failingChecks.length) return { kind: 'rerun', runs: flaky, work };
  const alreadyTried = f.previousFingerprint !== undefined ? f.previousFingerprint === sweepWorkFingerprint(work) : f.alreadyTried;
  if (alreadyTried) return skip('already-tried', `A fixer already had this exact state (${names(work.failingChecks) || 'its review items'}); the sweep acts again once the PR changes.`, work);
  if (!hasHumanItems(work) && f.canRepair) return { kind: 'repair', work };
  return { kind: 'fix', work };
}
