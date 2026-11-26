import type { Ticket } from '@factory/shared';
import type { MergeStatus } from '../github.ts';
import { stackBase } from './stacks.ts';

/** Open PRs that may still be drafts: known drafts and ones not synced yet. GitHub has the final say before each is marked ready. */
export function possibleDraftPrs<T extends Pick<Ticket, 'prNumber' | 'prState' | 'prDraft' | 'status'>>(tickets: T[]): T[] {
  return tickets.filter((t) => t.prNumber && t.prState === 'OPEN' && t.prDraft !== false && !['merged', 'canceled'].includes(t.status));
}

export const MERGE_QUEUE_ATTEMPTS_PER_HEAD = 3;

const READY_TO_MERGE = ['CLEAN', 'UNSTABLE', 'HAS_HOOKS'];

export type AutoMergeStep = 'mark-ready' | 'wait' | 'fix' | 'queue' | 'stop';

export function autoMergeStep(pr: Pick<MergeStatus, 'isDraft' | 'isInMergeQueue' | 'mergeStateStatus'> & { isBottom: boolean; queuedAtHead: number }): AutoMergeStep {
  if (pr.isDraft) return 'mark-ready';
  if (!pr.isBottom || pr.isInMergeQueue) return 'wait';
  if (!READY_TO_MERGE.includes(pr.mergeStateStatus)) return 'fix';
  return pr.queuedAtHead < MERGE_QUEUE_ATTEMPTS_PER_HEAD ? 'queue' : 'stop';
}

type Landable = Pick<Ticket, 'id' | 'key' | 'dependsOn' | 'status' | 'prNumber' | 'prState' | 'ciState' | 'baseRef' | 'branch' | 'prHeadRef'> &
  Partial<Pick<Ticket, 'prStack' | 'prDraft' | 'gateStatus'>>;

const landable = (t: Landable) =>
  t.status === 'approved' &&
  t.gateStatus !== 'waiting' &&
  !!t.prNumber &&
  t.prState === 'OPEN' &&
  t.prDraft === false &&
  (t.ciState === 'green' || t.ciState === 'none');

/**
 * For each stack, the highest PR such that it and every PR below it down to the base branch are approved and
 * green, with how many PRs below it land with it. Merging that PR through the merge queue lands them all at
 * once, instead of queueing the bottom one and rebasing the rest after each merge. Only runs of two or more, within
 * one GitHub stack, up to the first PR with two open PRs on it (the queue would land only one branch of the fork).
 */
export function landingTops<T extends Landable>(all: T[], baseBranch: string): { tops: Map<string, number>; carried: Set<string> } {
  const tops = new Map<string, number>();
  const carried = new Set<string>();
  for (const bottom of all.filter((t) => landable(t) && t.prStack != null && !stackBase(t, all) && (t.baseRef ?? baseBranch) === baseBranch)) {
    let top = bottom;
    let below = 0;
    for (;;) {
      const above = all.filter((t) => t.prNumber && t.prState === 'OPEN' && stackBase(t, all)?.id === top.id);
      const next = above.length === 1 && landable(above[0]) && above[0].prStack === bottom.prStack ? above[0] : null;
      if (!next) break;
      carried.add(top.id);
      top = next;
      below++;
    }
    if (below > 0) tops.set(top.id, below);
    else carried.delete(top.id);
  }
  return { tops, carried };
}
