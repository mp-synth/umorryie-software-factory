import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstLine, section, slugify, topoOrder, validatePlan } from './plan.ts';

const ticket = (key: string, depends_on: string[] = []) => ({
  key,
  title: `Implement the ${key} slice`,
  what: 'Adds a thing that users can see.',
  goal: 'So that the feature works end to end.',
  outcome: 'GET /thing returns 200 with the new field.',
  guidance: ['Touch src/thing.ts'],
  acceptance: ['pnpm test thing passes'],
  depends_on,
  size: 'S',
});

const plan = (tickets: unknown[]) => ({
  title: 'A feature',
  summary: ['Builds the thing', 'Split in slices'],
  goal: 'Users can do the thing end to end.',
  success_criteria: ['Thing works'],
  definition_of_done: ['All tickets approved'],
  test_strategy: ['Unit tests per slice'],
  tickets,
});

test('topoOrder keeps array order where dependencies allow and computes waves', () => {
  const order = topoOrder([
    { key: 'b', dependsOn: ['a'] },
    { key: 'a', dependsOn: [] },
    { key: 'c', dependsOn: [] },
    { key: 'd', dependsOn: ['b', 'c'] },
  ]);
  assert.deepEqual(order, [
    { key: 'a', seq: 1, wave: 0 },
    { key: 'b', seq: 2, wave: 1 },
    { key: 'c', seq: 3, wave: 0 },
    { key: 'd', seq: 4, wave: 2 },
  ]);
});

test('topoOrder detects cycles', () => {
  assert.equal(topoOrder([{ key: 'a', dependsOn: ['b'] }, { key: 'b', dependsOn: ['a'] }]), null);
});

test('validatePlan accepts a valid plan', () => {
  const r = validatePlan(plan([ticket('api'), ticket('ui', ['api'])]), 10);
  assert.deepEqual(r.errors, []);
  assert.equal(r.order?.length, 2);
});

test('validatePlan rejects unknown deps, duplicates, cycles and too many tickets', () => {
  assert.match(validatePlan(plan([ticket('a', ['zzz'])]), 10).errors.join(), /unknown key "zzz"/);
  assert.match(validatePlan(plan([ticket('a'), ticket('a')]), 10).errors.join(), /duplicate key/);
  assert.match(validatePlan(plan([ticket('a', ['b']), ticket('b', ['a'])]), 10).errors.join(), /cycle/);
  assert.match(validatePlan(plan([ticket('a'), ticket('b')]), 1).errors.join(), /limit is 1/);
  assert.match(validatePlan({ ...plan([ticket('a')]), summary: [] }, 10).errors.join(), /summary/);
});

test('firstLine, section and slugify', () => {
  assert.equal(firstLine('\n\nVERDICT: APPROVE\n## Summary'), 'VERDICT: APPROVE');
  assert.equal(section('X\n## Blocked\n1. why?\n## Next\nno', 'Blocked'), '1. why?');
  assert.equal(slugify('Add Dark Mode — to the App!'), 'add-dark-mode-to-the-app');
  assert.equal(slugify('Priorities and due dates for todos', 32), 'priorities-and-due-dates-for');
  assert.equal(slugify('x'.repeat(50), 10), 'xxxxxxxxxx');
});
