import type { Ticket } from '@factory/shared';
import type { MergeStatus } from '../github.ts';

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
