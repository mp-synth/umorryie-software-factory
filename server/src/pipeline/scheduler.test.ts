import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunKind } from '@factory/shared';
import { activeLanes, pickRunsToStart, type QueuedRun } from './scheduler.ts';

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

const lettered = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));

test('runs fifteen initiatives side by side, each up to its own parallel limit, when the pool has room', () => {
  const backlog = lettered(15).flatMap((init) => [1, 2, 3, 4, 5].map((t) => queued(`${init}${t}`, init, `${init}-t${t}`)));
  const started = pickRunsToStart(backlog, [], 60);
  assert.equal(started.length, 60);
  for (const init of lettered(15)) assert.equal(started.filter((r) => r.initiativeId === init).length, 4, init);
});

test('keeps every initiative moving when there are more initiatives than half the pool', () => {
  const backlog = lettered(15).flatMap((init) => [1, 2, 3, 4].map((t) => queued(`${init}${t}`, init, `${init}-t${t}`)));
  const started = pickRunsToStart(backlog, [], 20);
  const perInitiative = lettered(15).map((init) => started.filter((r) => r.initiativeId === init).length);
  assert.equal(Math.min(...perInitiative), 1);
  assert.equal(Math.max(...perInitiative), 2);
});

test('gives a free slot to a newly started initiative before a busy one gets another', () => {
  const running = [1, 2, 3].map((t) => ({ id: `r${t}`, initiativeId: 'A', ticketId: `a-t${t}`, kind: 'execute' as const }));
  const backlog = [queued('a4', 'A', 'a-t4'), queued('b1', 'B', 'b-t1')];
  assert.deepEqual(ids(pickRunsToStart(backlog, running, 1)), ['b1']);
});

test('counts an initiative as one lane however many of its runs wait or run', () => {
  assert.equal(activeLanes([queued('a1', 'A', 't1'), queued('a2', 'A', 't2'), queued('b1', 'B', 'u1'), { initiativeId: 'C' }]), 3);
  assert.equal(activeLanes([]), 0);
});

const oneEach = (slots: number) => ({ agentsPerInitiative: 1, slots });
const busy = (initiativeId: string, n: number) => Array.from({ length: n }, (_, t) => ({ id: `${initiativeId}-r${t}`, initiativeId, ticketId: `${initiativeId}-busy${t}`, kind: 'execute' as const }));

test('starts the guaranteed agent of an initiative that has none, even when the pool is full', () => {
  const backlog = [queued('a5', 'A', 'a-t5', 10), queued('c1', 'C', 'c-t1'), queued('c2', 'C', 'c-t2'), queued('d1', 'D', 'd-t1')];
  assert.deepEqual(ids(pickRunsToStart(backlog, [...busy('A', 4), ...busy('B', 4)], 0, oneEach(4))), ['c1', 'd1']);
});

test('gives no guaranteed agent to an initiative that already has one running', () => {
  assert.deepEqual(ids(pickRunsToStart([queued('a5', 'A', 'a-t5', 10)], busy('A', 1), 0, oneEach(4))), []);
});

test('stops handing out guaranteed agents when their slots run out', () => {
  const backlog = [queued('c1', 'C', 'c-t1'), queued('d1', 'D', 'd-t1'), queued('e1', 'E', 'e-t1')];
  assert.deepEqual(ids(pickRunsToStart(backlog, busy('A', 4), 0, oneEach(2))), ['c1', 'd1']);
});

test('fills free slots first and counts them toward the guaranteed slots', () => {
  const backlog = [queued('a5', 'A', 'a-t5', 10), queued('c1', 'C', 'c-t1'), queued('d1', 'D', 'd-t1')];
  assert.deepEqual(ids(pickRunsToStart(backlog, busy('A', 4), 1, oneEach(2))), ['c1', 'd1']);
});

test('without a guarantee a full pool starts nothing', () => {
  assert.deepEqual(pickRunsToStart([queued('c1', 'C', 'c-t1')], busy('A', 4), 0), []);
});
