import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TicketStatus } from '@factory/shared';
import { buildNumber, earlierBranches, rebuildBlocker, startedAbove } from './rebuild.ts';

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

test('rebuilds a ticket whose dependents started but are not approved, and resets them, highest first', () => {
  const all = [
    ticket('per-video', wanted),
    ticket('limits', 'factory/usage/02-limits', ['per-video'], 'in_review'),
    ticket('alerts', 'factory/usage/03-alerts', ['limits'], 'building'),
    ticket('export', 'factory/usage/04-export', ['per-video'], 'built'),
    ticket('later', null, ['alerts']),
    ticket('elsewhere', 'factory/usage/05-elsewhere', [], 'built'),
  ];
  assert.equal(rebuildBlocker(all[0], wanted, all), null);
  assert.deepEqual(
    startedAbove('per-video', all).map((t) => t.key),
    ['export', 'alerts', 'limits'],
  );
});

test('does not rebuild a ticket an approved ticket builds on', () => {
  const all = [ticket('per-video', wanted), ticket('limits', 'factory/usage/02-limits', ['per-video'], 'approved')];
  assert.match(rebuildBlocker(all[0], wanted, all) ?? '', /limits already build on its branch and was approved/);
});

test('ignores canceled dependents', () => {
  const all = [ticket('per-video', wanted), ticket('limits', 'factory/usage/02-limits', ['per-video'], 'canceled')];
  assert.equal(rebuildBlocker(all[0], wanted, all), null);
});

test('never rebuilds a PR the owner opened outside the factory', () => {
  const adopted = { ...ticket('pr-7', 'factory/pr-7'), prHeadRef: 'feature/x' };
  assert.match(rebuildBlocker(adopted, 'factory/pr-7', [adopted]) ?? '', /your own PR/);
});

test('stops rebuilding after the third build', () => {
  const third = ticket('per-video', `${wanted}-v3`);
  assert.match(rebuildBlocker(third, wanted, [third]) ?? '', /already built 3 times/);
  const second = ticket('per-video', `${wanted}-v2`);
  assert.equal(rebuildBlocker(second, wanted, [second]), null);
});

test('a rebuilt ticket that kept its branch still stops after the build limit', () => {
  const ticket = { key: 'videos', branch: 'factory/i/04-videos' };
  assert.equal(rebuildBlocker(ticket, 'factory/i/04-videos', [], 2), null);
  assert.match(rebuildBlocker(ticket, 'factory/i/04-videos', [], 3) ?? '', /already built 3 times/);
});
