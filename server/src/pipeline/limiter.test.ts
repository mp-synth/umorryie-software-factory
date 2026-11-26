import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fairLimiter, slotPool } from './limiter.ts';

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

test('heavy work takes several slots, and work heavier than the whole capacity still runs alone', async () => {
  const limiter = fairLimiter(() => 4);
  const heavy = job();
  const started: string[] = [];
  const runs = [
    limiter.run('A', () => (started.push('checks'), heavy.done), undefined, 3),
    limiter.run('B', async () => void started.push('another checks'), undefined, 3),
    limiter.run('C', async () => void started.push('checkout'), undefined, 1),
  ];
  await settle();
  assert.deepEqual(started, ['checks', 'checkout']);
  heavy.finish();
  await settle();
  assert.deepEqual(started, ['checks', 'checkout', 'another checks']);
  await Promise.all(runs);
  assert.equal(await limiter.run('A', async () => 'huge', undefined, 10), 'huge');
});

test('slots are numbered, never shared, and handed on when freed', async () => {
  const pool = slotPool(2);
  const held = [job(), job()];
  const slots: number[] = [];
  const runs = [pool.with((s) => (slots.push(s), held[0].done)), pool.with((s) => (slots.push(s), held[1].done)), pool.with(async (s) => void slots.push(s))];
  await settle();
  assert.deepEqual(slots, [1, 2]);
  held[1].finish();
  await settle();
  assert.deepEqual(slots, [1, 2, 2]);
  held[0].finish();
  await Promise.all(runs);
});

test('a slot held for work adopted after a restart is not handed out until that work ends', async () => {
  const pool = slotPool(2);
  let release!: () => void;
  const adopted = pool.holding(1, () => new Promise<void>((r) => (release = r)));
  const got = await pool.with(async (slot) => slot);
  assert.equal(got, 2);
  release();
  await adopted;
  assert.equal(await pool.with(async (slot) => slot), 1);
});

test('recovered slots can be reserved synchronously before scheduling starts', async () => {
  const pool = slotPool(2);
  const recovered = pool.reserve(1);
  assert.equal(recovered.slot, 1);
  assert.equal(await pool.with(async (slot) => slot), 2);
  recovered.release();
  assert.equal(await pool.with(async (slot) => slot), 1);
});

test('holding validates the slot and never grants double ownership', async () => {
  assert.throws(() => slotPool(0), /positive integer/);
  const pool = slotPool(2);
  await assert.rejects(pool.holding(0, async () => {}), /integer from 1 to 2/);
  await assert.rejects(pool.holding(3, async () => {}), /integer from 1 to 2/);

  const first = pool.reserve(1);
  let ran = false;
  await assert.rejects(
    pool.holding(1, async () => {
      ran = true;
    }),
    /already owned/,
  );
  assert.equal(ran, false);
  first.release();
  await pool.holding(1, async () => {
    ran = true;
  });
  assert.equal(ran, true);
});
