import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TicketStatus } from '@factory/shared';
import { buildNumber, earlierBranches, rebuildBlocker } from './rebuild.ts';

const wanted = 'factory/usage/01-per-video';
const ticket = (key: string, branch: string | null, dependsOn: string[] = [], status: TicketStatus = 'todo') => ({ key, branch, dependsOn, status });

test('numbers the first build 1 and each rebuild by its -v suffix', () => {
  assert.equal(buildNumber(wanted, wanted), 1);
  assert.equal(buildNumber(wanted, `${wanted}-v2`), 2);
  assert.equal(buildNumber(wanted, `${wanted}-v3`), 3);
  assert.equal(buildNumber(wanted, `${wanted}-vx`), 1);
});

test('lists the branches a rebuild replaces', () => {
  assert.deepEqual(earlierBranches(wanted, wanted), []);
  assert.deepEqual(earlierBranches(wanted, `${wanted}-v2`), [wanted]);
  assert.deepEqual(earlierBranches(wanted, `${wanted}-v3`), [wanted, `${wanted}-v2`]);
});

test('rebuilds a ticket nothing builds on yet', () => {
  const all = [ticket('per-video', wanted), ticket('limits', null, ['per-video'])];
  assert.equal(rebuildBlocker(all[0], wanted, all), null);
});

test('does not rebuild a ticket whose dependents already have a branch', () => {
  const all = [ticket('per-video', wanted), ticket('limits', 'factory/usage/02-limits', ['per-video'], 'building')];
  assert.match(rebuildBlocker(all[0], wanted, all) ?? '', /limits already build on its branch/);
});

test('ignores canceled dependents', () => {
  const all = [ticket('per-video', wanted), ticket('limits', 'factory/usage/02-limits', ['per-video'], 'canceled')];
  assert.equal(rebuildBlocker(all[0], wanted, all), null);
});

test('stops rebuilding after the third build', () => {
  const third = ticket('per-video', `${wanted}-v3`);
  assert.match(rebuildBlocker(third, wanted, [third]) ?? '', /already built 3 times/);
  const second = ticket('per-video', `${wanted}-v2`);
  assert.equal(rebuildBlocker(second, wanted, [second]), null);
});
