import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpenPr } from '../github.ts';
import { adoptablePrs, adoptedTicket, remoteBranchOf } from './adopted-prs.ts';

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

test('adopts the owner’s PRs that no ticket tracks yet', () => {
  const prs = [pr(1), pr(2), pr(3, { headRefName: 'factory/usage/01-x' }), pr(4, { isCrossRepository: true })];
  assert.deepEqual(adoptablePrs(prs, new Set([2])).map((p) => p.number), [1]);
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
