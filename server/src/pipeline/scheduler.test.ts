import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunKind } from '@factory/shared';
import { pickRunsToStart, type QueuedRun } from './scheduler.ts';

const queued = (id: string, initiativeId: string, ticketId: string | null, concurrency = 4, kind: RunKind = 'execute'): QueuedRun => ({
  id,
  initiativeId,
  ticketId,
  kind,
  concurrency,
});
const ids = (runs: QueuedRun[]) => runs.map((r) => r.id);

test('gives every initiative an agent before any gets a second', () => {
  const backlog = [queued('a1', 'A', 't1'), queued('a2', 'A', 't2'), queued('a3', 'A', 't3'), queued('b1', 'B', 'u1'), queued('c1', 'C', null, 4, 'plan')];
  assert.deepEqual(ids(pickRunsToStart(backlog, [], 3)), ['a1', 'b1', 'c1']);
});

test('counts agents already running toward an initiative share', () => {
  const running = [{ id: 'r', initiativeId: 'A', ticketId: 't9', kind: 'review' as const }];
  assert.deepEqual(ids(pickRunsToStart([queued('a1', 'A', 't1'), queued('b1', 'B', 'u1')], running, 1)), ['b1']);
});

test('keeps oldest-first order inside one initiative', () => {
  assert.deepEqual(ids(pickRunsToStart([queued('a1', 'A', 't1'), queued('a2', 'A', 't2')], [], 2)), ['a1', 'a2']);
});

test('holds an initiative to its own ticket concurrency', () => {
  const backlog = [queued('a1', 'A', 't1', 1), queued('a2', 'A', 't2', 1), queued('b1', 'B', 'u1', 1)];
  assert.deepEqual(ids(pickRunsToStart(backlog, [], 3)), ['a1', 'b1']);
});

test('never limits the advisor by ticket concurrency', () => {
  const running = [{ id: 'r', initiativeId: 'A', ticketId: 't1', kind: 'fix' as const }];
  assert.deepEqual(ids(pickRunsToStart([queued('ask', 'A', 't2', 1, 'ask')], running, 1)), ['ask']);
});

test('starts nothing without free slots', () => {
  assert.deepEqual(pickRunsToStart([queued('a1', 'A', 't1')], [], 0), []);
});
