import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { RunEvent } from '@factory/shared';
import { liveHub } from './live-hub.ts';

const RUN = '11111111-1111-4111-8111-111111111111';

function ev(id: number, runId = RUN): RunEvent {
  return { id: String(id), runId, ts: '2026-11-24T08:00:00Z', type: 'text', data: { n: id } };
}

function setup(stored: RunEvent[] = []) {
  const bus = new EventEmitter();
  let gate: Promise<void> = Promise.resolve();
  const hub = liveHub(bus, async (runId, after) => {
    await gate;
    return stored.filter((e) => e.runId === runId && Number(e.id) > after);
  });
  const sent: [string, unknown][] = [];
  const stream = hub.open((event, data) => sent.push([event, data]));
  const runIds = () => sent.filter(([t]) => t === 'run').map(([, e]) => Number((e as RunEvent).id));
  return { bus, hub, stream, sent, runIds, holdReplay: (p: Promise<void>) => (gate = p) };
}

test('a stream says hello with its id and carries every change', () => {
  const { bus, hub, stream, sent } = setup();
  bus.emit('change', { type: 'run', id: RUN });
  assert.deepEqual(sent, [
    ['hello', { id: stream.id }],
    ['change', { type: 'run', id: RUN }],
  ]);
  assert.equal(hub.get(stream.id), stream);
});

test('watching a run replays what came after `after`, marks ready, then sends new events', async () => {
  const { bus, stream, sent, runIds } = setup([ev(1), ev(2), ev(3)]);
  await stream.watch(RUN, 1);
  bus.emit(`run:${RUN}`, ev(4));
  assert.deepEqual(runIds(), [2, 3, 4]);
  assert.deepEqual(sent.find(([t]) => t === 'run-ready'), ['run-ready', { runId: RUN, last: 3 }]);
});

test('events that arrive during the replay follow it, without duplicates', async () => {
  const { bus, stream, runIds, holdReplay } = setup([ev(1), ev(2)]);
  let release!: () => void;
  holdReplay(new Promise<void>((r) => (release = r)));
  const watching = stream.watch(RUN, 0);
  bus.emit(`run:${RUN}`, ev(2)); // already stored: must not be sent twice
  bus.emit(`run:${RUN}`, ev(3));
  release();
  await watching;
  assert.deepEqual(runIds(), [1, 2, 3]);
});

test('unwatching stops a run, and watching again replays only what the tab missed', async () => {
  const stored = [ev(1)];
  const { bus, stream, runIds } = setup(stored);
  await stream.watch(RUN, 0);
  stream.unwatch(RUN);
  bus.emit(`run:${RUN}`, ev(2));
  stored.push(ev(2));
  assert.deepEqual(runIds(), [1]);
  await stream.watch(RUN, 1);
  assert.deepEqual(runIds(), [1, 2]);
});

test('unwatching during the replay sends nothing for that run', async () => {
  const { stream, sent, holdReplay } = setup([ev(1)]);
  let release!: () => void;
  holdReplay(new Promise<void>((r) => (release = r)));
  const watching = stream.watch(RUN, 0);
  stream.unwatch(RUN);
  release();
  await watching;
  assert.deepEqual(sent.map(([t]) => t), ['hello']);
});

test('closing a stream drops it and every listener it held', async () => {
  const { bus, hub, stream } = setup([ev(1)]);
  await stream.watch(RUN, 0);
  stream.close();
  assert.equal(hub.get(stream.id), undefined);
  assert.equal(bus.listenerCount('change'), 0);
  assert.equal(bus.listenerCount(`run:${RUN}`), 0);
});

test('a failed replay leaves no listener behind', async () => {
  const bus = new EventEmitter();
  const hub = liveHub(bus, async () => {
    throw new Error('db down');
  });
  const stream = hub.open(() => {});
  await assert.rejects(stream.watch(RUN, 0), /db down/);
  assert.equal(bus.listenerCount(`run:${RUN}`), 0);
});
