import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TicketStatus } from '@factory/shared';
import { mergedTicketCleanups } from './cleanup.ts';

const ticket = (key: string, status: TicketStatus, baseRef: string | null = 'main', worktreePath: string | null = `/wt/${key}`) => ({
  key,
  status,
  branch: `factory/i/${key}`,
  baseRef,
  worktreePath,
});

const cleanups = (tickets: ReturnType<typeof ticket>[]) =>
  mergedTicketCleanups(tickets).map(({ ticket: t, branchToDelete }) => ({ key: t.key, branchToDelete }));

test('removes the worktree and branch of a merged ticket', () => {
  assert.deepEqual(cleanups([ticket('01', 'merged')]), [{ key: '01', branchToDelete: 'factory/i/01' }]);
});

test('leaves tickets that are not merged alone', () => {
  assert.deepEqual(cleanups([ticket('01', 'approved'), ticket('02', 'in_review'), ticket('03', 'canceled')]), []);
});

test('keeps a merged branch while an unmerged stacked ticket still builds on it', () => {
  const tickets = [ticket('01', 'merged'), ticket('02', 'in_review', 'factory/i/01')];
  assert.deepEqual(cleanups(tickets), [{ key: '01', branchToDelete: null }]);
});

test('deletes a merged branch once the tickets stacked on it are merged or canceled', () => {
  const tickets = [ticket('01', 'merged', 'main', null), ticket('02', 'merged', 'factory/i/01'), ticket('03', 'canceled', 'factory/i/01')];
  assert.deepEqual(cleanups(tickets), [
    { key: '01', branchToDelete: 'factory/i/01' },
    { key: '02', branchToDelete: 'factory/i/02' },
  ]);
});

test('skips a merged ticket with no worktree whose branch is still in use', () => {
  const tickets = [ticket('01', 'merged', 'main', null), ticket('02', 'changes_requested', 'factory/i/01')];
  assert.deepEqual(cleanups(tickets), []);
});
