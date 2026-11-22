import type { MergeStatus } from '../github.ts';

export const MERGE_QUEUE_ATTEMPTS_PER_HEAD = 3;

const READY_TO_MERGE = ['CLEAN', 'UNSTABLE', 'HAS_HOOKS'];

export type AutoMergeStep = 'mark-ready' | 'wait' | 'fix' | 'queue' | 'stop';

export function autoMergeStep(pr: Pick<MergeStatus, 'isDraft' | 'isInMergeQueue' | 'mergeStateStatus'> & { isBottom: boolean; queuedAtHead: number }): AutoMergeStep {
  if (pr.isDraft) return 'mark-ready';
  if (!pr.isBottom || pr.isInMergeQueue) return 'wait';
  if (!READY_TO_MERGE.includes(pr.mergeStateStatus)) return 'fix';
  return pr.queuedAtHead < MERGE_QUEUE_ATTEMPTS_PER_HEAD ? 'queue' : 'stop';
}
