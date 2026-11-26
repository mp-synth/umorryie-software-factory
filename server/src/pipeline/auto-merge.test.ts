import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoMergeStep, landingTops, MERGE_QUEUE_ATTEMPTS_PER_HEAD, possibleDraftPrs } from './auto-merge.ts';

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

test('lands the approved, green bottom of a stack through its highest PR', () => {
  const t = (key: string, on: string | null, patch: Record<string, unknown> = {}) => ({
    id: key,
    key,
    dependsOn: on ? [on] : [],
    status: 'approved' as const,
    prNumber: 1,
    prState: 'OPEN',
    ciState: 'green' as const,
    baseRef: on ? `factory/x/${on}` : 'main',
    branch: `factory/x/${key}`,
    prHeadRef: null,
    prStack: 5,
    prDraft: false,
    ...patch,
  });
  const all = [t('a', null), t('b', 'a'), t('c', 'b', { ciState: 'red' }), t('d', 'c')];
  const { tops, carried } = landingTops(all, 'main');
  assert.deepEqual([...tops], [['b', 1]]);
  assert.deepEqual([...carried], ['a']);
  assert.equal(landingTops([t('a', null)], 'main').tops.size, 0, 'a single PR merges the usual way');
  assert.equal(landingTops([t('a', null), t('b', 'a', { gateStatus: 'waiting' })], 'main').tops.size, 0, 'a waiting gate cannot land');
});

test('a fork or a PR outside the GitHub stack ends the run that lands at once', () => {
  const t = (key: string, below: string | null, prStack: number | null | undefined = 5, prDraft = false) => ({
    id: key, key, dependsOn: below ? [below] : [], status: 'approved' as const, prNumber: key.charCodeAt(0), prState: 'OPEN',
    ciState: 'green' as const, baseRef: below ? `factory/x/${below}` : 'main', branch: `factory/x/${key}`, prHeadRef: null, prStack, prDraft,
  });
  const fork = [t('a', null), t('b', 'a'), t('c', 'a')];
  assert.equal(landingTops(fork, 'main').tops.size, 0);
  const outside = [t('a', null), t('b', 'a'), t('c', 'b', null)];
  assert.deepEqual([...landingTops(outside, 'main').tops], [['b', 1]]);
});

test('unknown stack identities and drafts are never carried', () => {
  const t = (key: string, below: string | null, prStack: number | null | undefined, prDraft = false) => ({
    id: key, key, dependsOn: below ? [below] : [], status: 'approved' as const, prNumber: key.charCodeAt(0), prState: 'OPEN',
    ciState: 'green' as const, baseRef: below ? `factory/x/${below}` : 'main', branch: `factory/x/${key}`, prHeadRef: null, prStack, prDraft,
  });
  for (const unknown of [null, undefined]) {
    const landing = landingTops([t('a', null, unknown), t('b', 'a', unknown)], 'main');
    assert.equal(landing.tops.size, 0);
    assert.equal(landing.carried.size, 0);
  }

  const draft = landingTops([t('a', null, 5), t('b', 'a', 5, true), t('c', 'b', 5)], 'main');
  assert.equal(draft.tops.size, 0);
  assert.equal(draft.carried.size, 0);
});
