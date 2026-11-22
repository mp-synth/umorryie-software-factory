import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CASES } from './fixtures.ts';
import { DEFAULT_REPEATS, parseRepeats, planArms, planCohort, selectCases } from './plan.ts';

test('plans cases x repeats x arms tasks', () => {
  const tasks = planCohort(['a', 'b', 'c'], ['A', 'B'], 2);
  assert.equal(tasks.length, 12);
  assert.equal(new Set(tasks.map((t) => t.id)).size, 12);
  assert.equal(planCohort(['a', 'b'], ['A'], 3).length, 6);
});

test('arm order alternates between repeats and is the same for every case in a repeat', () => {
  const tasks = planCohort(['a', 'b'], ['A', 'B'], 3);
  const order = (repeat: number, caseName: string) => tasks.filter((t) => t.repeat === repeat && t.caseName === caseName).map((t) => t.arm);
  assert.deepEqual(order(1, 'a'), ['A', 'B']);
  assert.deepEqual(order(2, 'a'), ['B', 'A']);
  assert.deepEqual(order(3, 'b'), ['A', 'B']);
  assert.deepEqual(order(2, 'b'), ['B', 'A']);
});

test('the cohort is deterministic', () => {
  assert.deepEqual(planCohort(['a', 'b'], ['A', 'B'], 2), planCohort(['a', 'b'], ['A', 'B'], 2));
});

test('one arm without --compare, two with it, the first on the factory file by default', () => {
  assert.deepEqual(planArms(null, null), [{ id: 'A', roleFile: null }]);
  assert.deepEqual(planArms('/x.md', '/y.md'), [
    { id: 'A', roleFile: '/x.md' },
    { id: 'B', roleFile: '/y.md' },
  ]);
  assert.deepEqual(planArms(null, '/y.md'), [
    { id: 'A', roleFile: null },
    { id: 'B', roleFile: '/y.md' },
  ]);
});

test('selectCases filters by role, keeps all when none are named and rejects unknown names', () => {
  assert.ok(selectCases('review', [], CASES).every((c) => c.role === 'review'));
  assert.deepEqual(selectCases('verify', ['verify-clean-fix'], CASES).map((c) => c.name), ['verify-clean-fix']);
  assert.throws(() => selectCases('review', ['verify-clean-fix'], CASES), /unknown review cases: verify-clean-fix/);
});

test('parseRepeats defaults to two and rejects anything but a positive whole number', () => {
  assert.equal(parseRepeats(undefined), DEFAULT_REPEATS);
  assert.equal(parseRepeats('3'), 3);
  for (const bad of ['0', '1.5', 'x', '-1']) assert.throws(() => parseRepeats(bad), /--repeats/);
});
