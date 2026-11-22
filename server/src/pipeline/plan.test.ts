import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlanJson } from '@factory/shared';
import { firstLine, missingPlanPaths, renderPlanContext, renderPlanPaths, section, slugify, stackDependencies, topoOrder, validatePlan } from './plan.ts';

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

const deps = (items: { key: string; dependsOn: string[] }[]) => Object.fromEntries(stackDependencies(items)!.map((t) => [t.key, t.dependsOn]));

test('stackDependencies chains tickets that fan out from one parent in plan order', () => {
  assert.deepEqual(
    deps([
      { key: 'alerts', dependsOn: [] },
      { key: 'reads', dependsOn: ['alerts'] },
      { key: 'cron', dependsOn: ['alerts'] },
      { key: 'sync', dependsOn: ['alerts', 'cron'] },
      { key: 'credits', dependsOn: ['alerts'] },
    ]),
    { alerts: [], reads: ['alerts'], cron: ['reads'], sync: ['cron'], credits: ['sync'] },
  );
});

test('stackDependencies keeps independent tickets apart and chains each group on its own', () => {
  assert.deepEqual(
    deps([
      { key: 'a', dependsOn: [] },
      { key: 'solo', dependsOn: [] },
      { key: 'x', dependsOn: [] },
      { key: 'b', dependsOn: ['a'] },
      { key: 'y', dependsOn: ['x'] },
      { key: 'c', dependsOn: ['a'] },
    ]),
    { a: [], solo: [], x: [], b: ['a'], y: ['x'], c: ['b'] },
  );
});

test('stackDependencies joins two roots that a later ticket needs into one line', () => {
  assert.deepEqual(deps([{ key: 'a', dependsOn: [] }, { key: 'b', dependsOn: [] }, { key: 'c', dependsOn: ['a', 'b'] }]), { a: [], b: ['a'], c: ['b'] });
});

test('stackDependencies refuses a cycle', () => {
  assert.equal(stackDependencies([{ key: 'a', dependsOn: ['b'] }, { key: 'b', dependsOn: ['a'] }]), null);
});

test('validatePlan stores the stacked dependencies, so a fan-out becomes a line of waves', () => {
  const r = validatePlan(plan([ticket('api'), ticket('ui', ['api']), ticket('cli', ['api'])]), 10);
  assert.deepEqual(r.plan?.tickets.map((t) => t.depends_on), [[], ['api'], ['ui']]);
  assert.deepEqual(r.order, [
    { key: 'api', seq: 1, wave: 0 },
    { key: 'ui', seq: 2, wave: 1 },
    { key: 'cli', seq: 3, wave: 2 },
  ]);
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

const withGuidance = (...guidance: string[]) => validatePlan(plan([{ ...ticket('a'), guidance }]), 5).plan as PlanJson;
const tracked = ['src/thing.ts', 'src/lib/util.ts', 'docs/readme.md'];
const missing = (...guidance: string[]) => missingPlanPaths(withGuidance(...guidance), tracked).map((m) => m.path);

test('missingPlanPaths reports a backticked path that is not tracked and accepts existing ones', () => {
  assert.deepEqual(missing('Edit `src/thing.ts` and `src/other.ts`'), ['src/other.ts']);
});

test('missingPlanPaths treats a directory as existing when a tracked file is under it', () => {
  assert.deepEqual(missing('Look in `src/lib/` and `src/nope/`'), ['src/nope/']);
});

test('missingPlanPaths strips a line suffix', () => {
  assert.deepEqual(missing('See `src/thing.ts:42` and `src/gone.ts:3-9`'), ['src/gone.ts']);
});

test('missingPlanPaths ignores globs, placeholders, URLs, spaces and tokens without a slash', () => {
  assert.deepEqual(missing('`src/**/*.ts`', '`src/<name>.ts`', '`src/{a,b}.ts`', '`https://example.com/x.html`', '`src/a b.ts`', '`missing.ts`', '`foo/bar`', 'src/unticked.ts'), []);
});

test('renderPlanPaths names each ticket and path', () => {
  const md = renderPlanPaths([{ ticket: 'a', path: 'src/x.ts' }]);
  assert.match(md, /- a: `src\/x\.ts`/);
  assert.match(md, /creates is fine/);
});

test('renderPlanContext carries goal, criteria, definition of done and edge cases only when present', () => {
  const full = renderPlanContext({ ...withGuidance('Touch it'), edge_cases: ['Empty input'] });
  assert.match(full, /## Goal\nUsers can do the thing end to end\./);
  assert.match(full, /## Success criteria\n- Thing works/);
  assert.match(full, /## Definition of done\n- All tickets approved/);
  assert.match(full, /## Edge cases\n- Empty input/);
  assert.doesNotMatch(renderPlanContext({ ...withGuidance('Touch it'), edge_cases: [] }), /Edge cases/);
});
