import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoMergeStep, MERGE_QUEUE_ATTEMPTS_PER_HEAD, possibleDraftPrs } from './auto-merge.ts';

test('marks ready only open PRs that are drafts or not synced yet', () => {
  const t = (prNumber: number | null, prState: string | null, prDraft: boolean | null | undefined, status = 'built') => ({ prNumber, prState, prDraft, status: status as 'built' });
  const tickets = [
    t(1, 'OPEN', true),
    t(2, 'OPEN', null),
    t(3, 'OPEN', undefined),
    t(4, 'OPEN', false),
    t(5, 'MERGED', true),
    t(6, 'CLOSED', true),
    t(null, null, null),
    t(8, 'OPEN', true, 'canceled'),
  ];
  assert.deepEqual(possibleDraftPrs(tickets).map((x) => x.prNumber), [1, 2, 3]);
});

const pr = (over: Partial<Parameters<typeof autoMergeStep>[0]> = {}) => ({
  isDraft: false,
  isInMergeQueue: false,
  mergeStateStatus: 'CLEAN',
  isBottom: true,
  queuedAtHead: 0,
  ...over,
});

test('marks a draft ready first, wherever it sits in the stack', () => {
  assert.equal(autoMergeStep(pr({ isDraft: true })), 'mark-ready');
  assert.equal(autoMergeStep(pr({ isDraft: true, isBottom: false })), 'mark-ready');
});

test('waits while PRs below are still open or the PR is already in the merge queue', () => {
  assert.equal(autoMergeStep(pr({ isBottom: false })), 'wait');
  assert.equal(autoMergeStep(pr({ isInMergeQueue: true })), 'wait');
});

test('queues the bottom PR once GitHub says it can merge', () => {
  for (const mergeStateStatus of ['CLEAN', 'UNSTABLE', 'HAS_HOOKS']) assert.equal(autoMergeStep(pr({ mergeStateStatus })), 'queue');
});

test('looks for something to fix when the bottom PR conflicts, fails checks or is blocked', () => {
  for (const mergeStateStatus of ['DIRTY', 'BLOCKED', 'BEHIND', 'UNKNOWN']) assert.equal(autoMergeStep(pr({ mergeStateStatus })), 'fix');
});

test('stops re-queueing a commit the merge queue keeps taking out', () => {
  assert.equal(autoMergeStep(pr({ queuedAtHead: MERGE_QUEUE_ATTEMPTS_PER_HEAD - 1 })), 'queue');
  assert.equal(autoMergeStep(pr({ queuedAtHead: MERGE_QUEUE_ATTEMPTS_PER_HEAD })), 'stop');
});
