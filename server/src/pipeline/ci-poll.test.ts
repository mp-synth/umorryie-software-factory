import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CiHeadsSeen, ciSettledGreen, ciSettledRed, ciWorthPolling } from './ci-poll.ts';

const failing = [{ name: 'test-unit', url: null, conclusion: 'FAILURE' }] as never[];

const now = new Date('2026-11-23T19:00:00Z').getTime();
const ago = (minutes: number) => now - minutes * 60_000;
const at = (minutesAgo: number) => new Date(ago(minutesAgo)).toISOString();

test('a PR is polled while its CI runs or has not reported, and not once it is green', () => {
  assert.equal(ciWorthPolling({ ciState: null, ciHeadSha: null, updatedAt: at(30) }, undefined, ago(30), now), true);
  assert.equal(ciWorthPolling({ ciState: 'pending', ciHeadSha: 'a1', updatedAt: at(30) }, undefined, ago(30), now), true);
  assert.equal(ciWorthPolling({ ciState: 'green', ciHeadSha: 'a1', updatedAt: at(1) }, undefined, ago(1), now), false);
});

test('pending CI stops being polled two hours after the head last changed', () => {
  assert.equal(ciWorthPolling({ ciState: 'pending', ciHeadSha: 'a1', updatedAt: at(1) }, undefined, ago(119), now), true);
  assert.equal(ciWorthPolling({ ciState: 'pending', ciHeadSha: 'a1', updatedAt: at(1) }, undefined, ago(121), now), false);
});

test('a head is dated from its first sighting, and a new head starts the clock again', () => {
  const seen = new CiHeadsSeen();
  assert.equal(seen.since('t1', 'a1', ago(130)), ago(130));
  assert.equal(seen.since('t1', 'a1', now), ago(130));
  assert.equal(seen.since('t1', 'b2', now), now);
  assert.equal(seen.since('t2', 'a1', now), now, 'per ticket');
});

test('a PR with no checks is polled for a while after a push, then counts as having no CI', () => {
  assert.equal(ciWorthPolling({ ciState: 'none', ciHeadSha: 'a1', updatedAt: at(2) }, undefined, ago(2), now), true);
  assert.equal(ciWorthPolling({ ciState: 'none', ciHeadSha: 'a1', updatedAt: at(11) }, undefined, ago(11), now), false);
});

test('a red PR is polled until its settled failure at that head was handed to the sweep', () => {
  assert.equal(ciWorthPolling({ ciState: 'red', ciHeadSha: 'a1', updatedAt: at(1) }, undefined, ago(1), now), true);
  assert.equal(ciWorthPolling({ ciState: 'red', ciHeadSha: 'a1', updatedAt: at(1) }, 'a1', ago(1), now), false);
  assert.equal(ciWorthPolling({ ciState: 'red', ciHeadSha: 'b2', updatedAt: at(1) }, 'a1', ago(1), now), true, 'a new commit is red again');
});

test('CI is handed over only once it has finished red, so the fixer sees every failure at once', () => {
  assert.equal(ciSettledRed({ failingChecks: failing, pendingChecks: ['test-unit-shard (2)'], finishedChecks: 3, headRefOid: 'a1' }, undefined), false, 'other checks still run');
  assert.equal(ciSettledRed({ failingChecks: failing, pendingChecks: [], finishedChecks: 3, headRefOid: 'a1' }, undefined), true);
  assert.equal(ciSettledRed({ failingChecks: failing, pendingChecks: [], finishedChecks: 3, headRefOid: 'a1' }, 'a1'), false, 'already handed over');
  assert.equal(ciSettledRed({ failingChecks: [], pendingChecks: [], finishedChecks: 3, headRefOid: 'a1' }, undefined), false, 'green');
});

test('CI that finished green is handed over once per head, so review threads bots posted are swept at once', () => {
  assert.equal(ciSettledGreen({ failingChecks: [], pendingChecks: ['Cursor Bugbot'], finishedChecks: 3, headRefOid: 'a1' }, undefined), false, 'a bot still reviews');
  assert.equal(ciSettledGreen({ failingChecks: [], pendingChecks: [], finishedChecks: 3, headRefOid: 'a1' }, undefined), true);
  assert.equal(ciSettledGreen({ failingChecks: [], pendingChecks: [], finishedChecks: 3, headRefOid: 'a1' }, 'a1'), false, 'already handed over');
  assert.equal(ciSettledGreen({ failingChecks: [], pendingChecks: [], finishedChecks: 0, headRefOid: 'a1' }, undefined), false, 'no check reported yet');
  assert.equal(ciSettledGreen({ failingChecks: failing, pendingChecks: [], finishedChecks: 3, headRefOid: 'a1' }, undefined), false, 'red');
});
