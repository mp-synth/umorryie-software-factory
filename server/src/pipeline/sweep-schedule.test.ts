import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { CoalescedRun, SweepSchedule } from './sweep-schedule.ts';

test('many requests for one initiative leave one timer, and other initiatives keep their own', async () => {
  const schedule = new SweepSchedule();
  const ran: string[] = [];
  for (let i = 0; i < 5; i++) schedule.schedule('init-a', 20, async () => void ran.push('a'));
  schedule.schedule('init-b', 20, async () => void ran.push('b'));
  await sleep(60);
  assert.deepEqual(ran.sort(), ['a', 'b']);
});

test('a sooner request replaces a later timer, a later one waits for the sooner', async () => {
  const schedule = new SweepSchedule();
  const ran: string[] = [];
  schedule.schedule('init-a', 200, async () => void ran.push('late'));
  schedule.schedule('init-a', 10, async () => void ran.push('soon'));
  schedule.schedule('init-a', 100, async () => void ran.push('later'));
  await sleep(250);
  assert.deepEqual(ran, ['soon']);
  schedule.schedule('init-a', 10, async () => void ran.push('next'));
  await sleep(40);
  assert.deepEqual(ran, ['soon', 'next'], 'a timer that fired no longer blocks new ones');
});

test('a sweep asked for during a pass is owed once, as manual if any request was', () => {
  const schedule = new SweepSchedule();
  assert.equal(schedule.begin('init-a'), true);
  assert.equal(schedule.begin('init-a'), false);
  assert.equal(schedule.begin('init-a', true), false);
  assert.equal(schedule.begin('init-b'), true, 'other initiatives sweep in parallel');
  assert.deepEqual(schedule.end('init-a'), { manual: true });
  assert.equal(schedule.end('init-b'), null);
  assert.equal(schedule.begin('init-a'), true);
  assert.equal(schedule.end('init-a'), null);
});

test('concurrent callers await the requested rerun, not only the pass already running', async () => {
  const runs = new CoalescedRun();
  let release!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const firstCanFinish = new Promise<void>((resolve) => {
    release = resolve;
  });
  let passes = 0;
  const work = async () => {
    passes++;
    if (passes === 1) {
      started();
      await firstCanFinish;
    }
    return true;
  };

  const first = runs.run('stack-a', work);
  await firstStarted;
  const waitingForRerun = runs.run('stack-a', work);
  assert.equal(waitingForRerun, first);
  release();
  assert.equal(await waitingForRerun, true);
  assert.equal(passes, 2);
});

test('a failed pass releases the key when nobody requested another pass', async () => {
  const runs = new CoalescedRun();
  let passes = 0;
  assert.equal(
    await runs.run('stack-a', async () => {
      passes++;
      return false;
    }),
    false,
  );
  assert.equal(passes, 1);
  assert.equal(await runs.run('stack-a', async () => true), true);
});

test('a rerun requested during a failed pass still runs before shared callers continue', async () => {
  const runs = new CoalescedRun();
  let passes = 0;
  const work = async () => {
    passes++;
    if (passes === 1) void runs.run('stack-a', work);
    return passes > 1;
  };
  assert.equal(await runs.run('stack-a', work), true);
  assert.equal(passes, 2);
});
