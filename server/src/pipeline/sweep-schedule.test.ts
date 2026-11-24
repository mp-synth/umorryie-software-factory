import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { SweepSchedule } from './sweep-schedule.ts';

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
