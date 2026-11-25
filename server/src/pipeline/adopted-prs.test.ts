import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpenPr } from '../github.ts';
import { adoptablePrs, adoptedTicket, remoteBranchOf, reopenedTicket } from './adopted-prs.ts';

const pr = (number: number, patch: Partial<OpenPr> = {}): OpenPr => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  body: '',
  headRefName: `feature/${number}`,
  baseRefName: 'master',
  isCrossRepository: false,
  ...patch,
});

test('adopts the owner’s PRs that no live ticket or initiative looks after', () => {
  const prs = [
    pr(1),
    pr(2),
    pr(3, { headRefName: 'factory/usage-1a2b3c4d/01-x' }),
    pr(4, { headRefName: 'factory/usage-1a2b3c4d/02-y-v2' }),
    pr(5, { headRefName: 'factory/archived-9f8e7d6c/01-z' }),
    pr(6, { isCrossRepository: true }),
  ];
  const live = { prNumbers: new Set([2]), branchPrefixes: ['factory/usage-1a2b3c4d/'] };
  assert.deepEqual(adoptablePrs(prs, live).map((p) => p.number), [1, 5]);
});

test('a PR opened again goes back to work on the same ticket', () => {
  const back = reopenedTicket(pr(42, { headRefName: 'cursor-matej/fix' }));
  assert.equal(back.status, 'built');
  assert.equal(back.prState, 'OPEN');
  assert.equal(back.prHeadRef, 'cursor-matej/fix');
  assert.equal(back.prSweepFingerprint, null);
  for (const kept of ['key', 'seq', 'round', 'worktreePath']) assert.ok(!(kept in back), kept);
});

test('builds a ticket that fixes the PR on its own branch and is never built from scratch', () => {
  const t = adoptedTicket(pr(42, { headRefName: 'cursor-matej/fix', baseRefName: 'main', body: 'Fixes the swap.\nSecond line' }), 3);
  assert.equal(t.key, 'pr-42');
  assert.equal(t.seq, 3);
  assert.equal(t.status, 'built');
  assert.equal(t.branch, 'factory/pr-42');
  assert.equal(t.prHeadRef, 'cursor-matej/fix');
  assert.equal(t.baseRef, 'main');
  assert.equal(t.prNumber, 42);
  assert.match(t.what, /> Fixes the swap\.\n> Second line/);
  assert.equal(remoteBranchOf(t), 'cursor-matej/fix');
});

test('a factory ticket pushes to the branch it built', () => {
  assert.equal(remoteBranchOf({ branch: 'factory/usage/01-x', prHeadRef: null }), 'factory/usage/01-x');
});
