import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fairLimiter } from './limiter.ts';

function job() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { done, finish };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('runs work right away while slots are free', async () => {
  const limiter = fairLimiter(() => 2);
  const waited: string[] = [];
  const results = await Promise.all([
    limiter.run('A', async () => 'a', () => waited.push('a')),
    limiter.run('B', async () => 'b', () => waited.push('b')),
  ]);
  assert.deepEqual(results, ['a', 'b']);
  assert.deepEqual(waited, []);
});

test('never runs more than its size at once', async () => {
  const limiter = fairLimiter(() => 2);
  const jobs = [job(), job(), job()];
  const started: number[] = [];
  const runs = jobs.map((j, i) => limiter.run('A', () => (started.push(i), j.done)));
  await settle();
  assert.deepEqual(started, [0, 1]);
  jobs[0].finish();
  await settle();
  assert.deepEqual(started, [0, 1, 2]);
  jobs[1].finish();
  jobs[2].finish();
  await Promise.all(runs);
});

test('tells work that has to wait, and only that work', async () => {
  const limiter = fairLimiter(() => 1);
  const first = job();
  const waited: string[] = [];
  const a = limiter.run('A', () => first.done, () => waited.push('first'));
  const b = limiter.run('A', async () => {}, () => waited.push('second'));
  assert.deepEqual(waited, ['second']);
  first.finish();
  await Promise.all([a, b]);
});

test('gives a freed slot to the initiative holding the fewest, before an earlier request from a busier one', async () => {
  const limiter = fairLimiter(() => 2);
  const holding = [job(), job()];
  const started: string[] = [];
  const runs = [
    limiter.run('A', () => holding[0].done),
    limiter.run('A', () => holding[1].done),
    limiter.run('A', async () => void started.push('a3')),
    limiter.run('B', async () => void started.push('b1')),
  ];
  await settle();
  holding[0].finish();
  await settle();
  assert.deepEqual(started, ['b1', 'a3']);
  holding[1].finish();
  await Promise.all(runs);
});

test('frees the slot when the work throws', async () => {
  const limiter = fairLimiter(() => 1);
  await assert.rejects(limiter.run('A', async () => Promise.reject(new Error('setup failed'))), /setup failed/);
  assert.equal(await limiter.run('A', async () => 'next'), 'next');
});
