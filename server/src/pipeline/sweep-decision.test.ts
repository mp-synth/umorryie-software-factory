import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrSnapshot, ReviewThread } from '../github.ts';
import { prWorkFingerprint, prWorkFrom, withoutInherited } from './pr-work.ts';
import { decideSweep, sweepDecisionFingerprint, type SweepFacts } from './sweep-decision.ts';

const snapshot = (patch: Partial<PrSnapshot> = {}): PrSnapshot => ({
  number: 7,
  url: 'https://github.com/o/r/pull/7',
  state: 'OPEN',
  isDraft: true,
  mergeable: 'MERGEABLE',
  baseRefName: 'main',
  headRefOid: 'abc',
  failingChecks: [],
  supersededChecks: [],
  pendingChecks: [],
  finishedChecks: 3,
  hungJobs: [],
  comments: [],
  reviews: [],
  ...patch,
});

const thread: ReviewThread = {
  id: 't',
  rootCommentId: 1,
  rootAuthor: 'alice',
  rootIsBot: false,
  path: 'a.py',
  line: 1,
  outdated: false,
  awaitingReviewer: false,
  lastCommentAt: '2026-01-01T10:00:00Z',
  comments: [{ author: 'alice', body: 'rename' }],
};

const facts = (snap: Partial<PrSnapshot>, patch: Partial<SweepFacts> = {}, threads: ReviewThread[] = []): SweepFacts => ({
  work: prWorkFrom(snapshot(snap), threads, { lastFixAt: null, noiseCommentAuthors: [] }),
  alreadyTried: false,
  inheritedChecks: [],
  flakyRuns: [],
  conflictConfirmed: null,
  canRepair: true,
  unreadyBelow: null,
  ...patch,
});

const lint = { name: 'lint', url: 'https://github.com/o/r/actions/runs/11/job/22' };
const tests = { name: 'test-unit', url: 'https://github.com/o/r/actions/runs/12/job/23' };

test('a clean PR is skipped as idle', () => {
  assert.equal(decideSweep(facts({})).kind, 'skip');
});

test('deterministic failures go to a script repair, not to an agent', () => {
  assert.equal(decideSweep(facts({ failingChecks: [lint] })).kind, 'repair');
  assert.equal(decideSweep(facts({ mergeable: 'CONFLICTING' })).kind, 'repair');
});

test('without a checks command the failures go straight to a fixer', () => {
  assert.equal(decideSweep(facts({ failingChecks: [lint] }, { canRepair: false })).kind, 'fix');
});

test('review threads always go to a fixer', () => {
  assert.equal(decideSweep(facts({ failingChecks: [lint] }, {}, [thread])).kind, 'fix');
});

test('a PR below that is not ready holds CI and conflict work, but not when there is none', () => {
  const held = decideSweep(facts({ failingChecks: [lint] }, { unreadyBelow: '#2' }));
  assert.equal(held.kind === 'skip' && held.reason, 'stack-below');
  assert.equal(decideSweep(facts({}, { unreadyBelow: '#2' }, [thread])).kind, 'fix');
});

test('review items wait until every check and bot reviewer is done', () => {
  const waited = decideSweep(facts({ pendingChecks: ['Cursor Bugbot'] }, {}, [thread]));
  assert.equal(waited.kind === 'skip' && waited.reason, 'ci-running');
});

test('failures that also fail on the base are not the PR’s', () => {
  const d = decideSweep(facts({ failingChecks: [tests] }, { inheritedChecks: ['test-unit'] }));
  assert.equal(d.kind === 'skip' && d.reason, 'inherited');
  assert.equal(decideSweep(facts({ failingChecks: [tests, lint] }, { inheritedChecks: ['test-unit'] })).kind, 'repair');
});

test('a stale conflict GitHub has not re-checked is dropped', () => {
  const d = decideSweep(facts({ mergeable: 'CONFLICTING' }, { conflictConfirmed: false }));
  assert.equal(d.kind, 'skip');
  assert.ok(d.work.ignored.some((line) => line.includes('merges cleanly')));
});

test('flaky failures get one re-run, only when nothing else needs work', () => {
  const flakyRuns = [{ name: 'test-unit', runId: '12' }];
  const rerun = decideSweep(facts({ failingChecks: [tests] }, { flakyRuns }));
  assert.deepEqual(rerun.kind === 'rerun' && rerun.runs, flakyRuns);
  assert.equal(decideSweep(facts({ failingChecks: [tests, lint] }, { flakyRuns })).kind, 'repair');
});

test('a state a fixer already had is skipped', () => {
  const d = decideSweep(facts({ failingChecks: [lint] }, { alreadyTried: true }));
  assert.equal(d.kind === 'skip' && d.reason, 'already-tried');
});

test('fingerprints and previous-state checks use the cleaned decision work', () => {
  const original = facts({ failingChecks: [tests, lint] }, { inheritedChecks: ['test-unit'] });
  const cleaned = withoutInherited(original.work, ['test-unit']);
  const previousFingerprint = prWorkFingerprint(cleaned);
  const decision = decideSweep({ ...original, alreadyTried: false, previousFingerprint });

  assert.equal(decision.kind === 'skip' && decision.reason, 'already-tried');
  assert.equal(sweepDecisionFingerprint(decision), previousFingerprint);
  assert.notEqual(sweepDecisionFingerprint(decision), prWorkFingerprint(original.work));
});

test('checks only people turn green leave nothing for a fixer, and say what they wait for', () => {
  const work = prWorkFrom(snapshot({ failingChecks: [{ name: 'Meticulous Tests', url: null }] }), [], {
    lastFixAt: null,
    noiseCommentAuthors: [],
    classify: () => ({ class: 'people-only', note: 'a visual-diff approval', needsLog: false }),
  });
  const d = decideSweep({ ...facts({}), work });
  assert.equal(d.kind === 'skip' && d.reason, 'waiting-on');
  assert.deepEqual(work.waitingOn, ['Meticulous Tests: a visual-diff approval']);
});
