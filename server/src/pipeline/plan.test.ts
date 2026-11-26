import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlanJson } from '@factory/shared';
import { firstLine, missingPlanPaths, renderPlanContext, renderPlanPaths, renderStacking, section, sharedHotspots, slugify, stackDependencies, stackShape, topoOrder, touchesOverlap, validatePlan } from './plan.ts';

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

test('stackDependencies stacks tickets that need the same ticket side by side on it', () => {
  assert.deepEqual(
    deps([
      { key: 'alerts', dependsOn: [] },
      { key: 'reads', dependsOn: ['alerts'] },
      { key: 'cron', dependsOn: ['alerts'] },
      { key: 'sync', dependsOn: ['alerts', 'cron'] },
      { key: 'credits', dependsOn: ['alerts'] },
    ]),
    { alerts: [], reads: ['alerts'], cron: ['alerts'], sync: ['cron'], credits: ['alerts'] },
  );
});

test('stackDependencies keeps independent tickets apart', () => {
  assert.deepEqual(
    deps([
      { key: 'a', dependsOn: [] },
      { key: 'solo', dependsOn: [] },
      { key: 'x', dependsOn: [] },
      { key: 'b', dependsOn: ['a'] },
      { key: 'y', dependsOn: ['x'] },
      { key: 'c', dependsOn: ['a'] },
    ]),
    { a: [], solo: [], x: [], b: ['a'], y: ['x'], c: ['a'] },
  );
});

test('stackDependencies joins two roots that a later ticket needs into one line', () => {
  assert.deepEqual(deps([{ key: 'a', dependsOn: [] }, { key: 'b', dependsOn: [] }, { key: 'c', dependsOn: ['a', 'b'] }]), { a: [], b: ['a'], c: ['b'] });
});

test('stackDependencies puts the later of two siblings a ticket needs on top of the earlier, and only those', () => {
  // The Salesforce plan's real needs: only update goes on create-organization, so renewal has one base.
  const needs = [
    { key: 'invites', dependsOn: [] },
    { key: 'api', dependsOn: ['invites'] },
    { key: 'admins-add', dependsOn: ['api'] },
    { key: 'admins-remove', dependsOn: ['api'] },
    { key: 'create-ws', dependsOn: ['api'] },
    { key: 'create-org', dependsOn: ['create-ws'] },
    { key: 'update', dependsOn: ['create-ws'] },
    { key: 'renewal', dependsOn: ['update', 'create-org'] },
    { key: 'renew', dependsOn: ['renewal', 'api'] },
  ];
  const stacked = stackDependencies(needs)!;
  assert.deepEqual(Object.fromEntries(stacked.map((t) => [t.key, t.dependsOn])), {
    invites: [],
    api: ['invites'],
    'admins-add': ['api'],
    'admins-remove': ['api'],
    'create-ws': ['api'],
    'create-org': ['create-ws'],
    update: ['create-org'],
    renewal: ['update'],
    renew: ['renewal'],
  });
  const shape = stackShape(needs, stacked);
  assert.deepEqual(shape.longest, ['invites', 'api', 'create-ws', 'create-org', 'update', 'renewal', 'renew']);
  assert.equal(shape.widest, 3);
  assert.deepEqual(shape.forced, [{ key: 'update', on: 'create-org' }]);
});

test('stackDependencies leaves a foundation-first plan as a wide tree', () => {
  const needs = [
    { key: 'invites', dependsOn: [] },
    { key: 'foundation', dependsOn: ['invites'] },
    ...['reads', 'admins-add', 'admins-remove', 'create-ws', 'create-org', 'update'].map((key) => ({ key, dependsOn: ['foundation'] })),
    { key: 'renewal', dependsOn: ['create-org', 'foundation'] },
    { key: 'renew', dependsOn: ['renewal'] },
  ];
  const shape = stackShape(needs, stackDependencies(needs)!);
  assert.equal(shape.longest.length, 5);
  assert.equal(shape.widest, 6);
  assert.deepEqual(shape.forced, []);
});

test('stackDependencies never adds a cycle, whatever the plan order', () => {
  const needs = [
    { key: 'd', dependsOn: ['b', 'c'] },
    { key: 'c', dependsOn: ['a'] },
    { key: 'b', dependsOn: ['a'] },
    { key: 'a', dependsOn: [] },
    { key: 'e', dependsOn: ['d', 'b'] },
  ];
  const stacked = stackDependencies(needs)!;
  assert.ok(topoOrder(stacked));
  for (const t of stacked) assert.ok(t.dependsOn.length <= 1, t.key);
  // Every need is still below the ticket in its line.
  const parent = new Map(stacked.map((t) => [t.key, t.dependsOn[0]]));
  const line = (k: string): string[] => (parent.get(k) ? [parent.get(k)!, ...line(parent.get(k)!)] : []);
  for (const t of needs) for (const d of t.dependsOn) assert.ok(line(t.key).includes(d), `${t.key} needs ${d}`);
});

test('stackDependencies refuses a cycle', () => {
  assert.equal(stackDependencies([{ key: 'a', dependsOn: ['b'] }, { key: 'b', dependsOn: ['a'] }]), null);
});

test('validatePlan keeps what each ticket needs in the plan and stacks a fan-out side by side', () => {
  const r = validatePlan(plan([ticket('api'), ticket('ui', ['api']), ticket('cli', ['api', 'ui'])]), 10);
  assert.deepEqual(r.plan?.tickets.map((t) => t.depends_on), [[], ['api'], ['api', 'ui']]);
  assert.deepEqual(r.stacked?.map((t) => t.depends_on), [[], ['api'], ['ui']]);
  assert.deepEqual(r.order, [
    { key: 'api', seq: 1, wave: 0 },
    { key: 'ui', seq: 2, wave: 1 },
    { key: 'cli', seq: 3, wave: 2 },
  ]);
  const wide = validatePlan(plan([ticket('api'), ticket('ui', ['api']), ticket('cli', ['api'])]), 10);
  assert.deepEqual(wide.order?.map((o) => o.wave), [0, 1, 1]);
});

test('renderStacking lists each base, the longest line, the most at once and forced stacks', () => {
  const needs = [
    { key: 'a', dependsOn: [] },
    { key: 'b', dependsOn: ['a'] },
    { key: 'c', dependsOn: ['a'] },
    { key: 'd', dependsOn: ['b', 'c'] },
  ];
  const md = renderStacking(needs, stackDependencies(needs)!, 4);
  assert.match(md, /- a: on the base branch/);
  assert.match(md, /- c: on b/);
  assert.match(md, /Longest line: 4 tickets \(a → b → c → d\)/);
  assert.match(md, /Most at once: 1 ticket; this initiative runs up to 4/);
  assert.match(md, /- c on b/);
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

const planWith = (tickets: { key: string; depends_on?: string[]; touches?: string[] }[]) => ({
  title: 'Plan title',
  summary: ['first bullet here', 'second bullet here'],
  goal: 'Users get the feature.',
  success_criteria: ['a criterion'],
  definition_of_done: ['a done item'],
  test_strategy: ['unit tests'],
  tickets: tickets.map((t) => ({
    key: t.key,
    title: `Build the ${t.key} part`,
    what: 'What happens here.',
    goal: 'Why it matters here.',
    outcome: 'The measurable result.',
    guidance: ['follow the code'],
    acceptance: ['a check'],
    depends_on: t.depends_on ?? [],
    size: 'S',
    touches: t.touches ?? [],
  })),
});

test('side-by-side tickets that touch the same files are chained, generated files aside', () => {
  const { stacked } = validatePlan(
    planWith([
      { key: 'base', touches: ['svc/routes.py'] },
      { key: 'a', depends_on: ['base'], touches: ['svc/errors.py', 'generated:idl/openapi.json'] },
      { key: 'b', depends_on: ['base'], touches: ['svc/b.py', 'generated:idl/openapi.json'] },
      { key: 'c', depends_on: ['base'], touches: ['svc/'] },
    ]),
    10,
  );
  const on = Object.fromEntries(stacked!.map((t) => [t.key, t.depends_on[0] ?? null]));
  assert.deepEqual([on.a, on.b, on.c], ['base', 'a', 'b'], 'svc/ covers both siblings, so the three form one line');
  const generatedOnly = validatePlan(planWith([{ key: 'base' }, { key: 'a', depends_on: ['base'], touches: ['generated:idl/x.json'] }, { key: 'b', depends_on: ['base'], touches: ['generated:idl/x.json'] }]), 10);
  assert.deepEqual(generatedOnly.stacked!.map((t) => t.depends_on[0] ?? null), [null, 'base', 'base'], 'a shared generated file does not chain them');
});

test('four or more tickets on one hotspot are fully serialized', () => {
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const { stacked, needs } = validatePlan(
    planWith(keys.map((key) => ({ key, touches: ['src/shared/hotspot.ts'] }))),
    10,
  );
  const parent = new Map(stacked!.map((t) => [t.key, t.depends_on[0] ?? null]));
  const isBelow = (low: string, high: string) => {
    for (let current: string | null | undefined = parent.get(high); current; current = parent.get(current)) {
      if (current === low) return true;
    }
    return false;
  };

  for (const [i, later] of keys.entries()) {
    for (const earlier of keys.slice(0, i)) assert.equal(isBelow(earlier, later), true, `${earlier} must be below ${later}`);
  }
  assert.deepEqual(needs!.get('e'), ['a', 'b', 'c', 'd']);
});

test('in one line every ticket stacks on the one before it, in plan order', () => {
  const { stacked, order } = validatePlan(planWith([{ key: 'base' }, { key: 'a', depends_on: ['base'] }, { key: 'b', depends_on: ['base'] }]), 10, { line: true });
  assert.deepEqual(stacked!.map((t) => t.depends_on), [[], ['base'], ['a']]);
  assert.deepEqual(order!.map((o) => o.wave), [0, 1, 1], 'a and b still build side by side');
});

test('touchesOverlap compares files and folders', () => {
  assert.deepEqual(touchesOverlap(['src/a.ts'], ['src/a.ts']), ['src/a.ts']);
  assert.deepEqual(touchesOverlap(['src/'], ['src/b/c.ts']), ['src/']);
  assert.deepEqual(touchesOverlap(['src/a.ts'], ['src/b.ts']), []);
  assert.deepEqual(touchesOverlap(['generated:idl/x.json'], ['generated:idl/x.json']), []);
});

test('the stacking note names the PRs that fall outside the single GitHub stack', () => {
  const md = renderStacking([{ key: 'base', dependsOn: [] }, { key: 'a', dependsOn: ['base'] }, { key: 'b', dependsOn: ['base'] }], [{ key: 'base', dependsOn: [] }, { key: 'a', dependsOn: ['base'] }, { key: 'b', dependsOn: ['base'] }], 4);
  assert.match(md, /sit outside it .*: b\./);
});

test('a ticket waits for an earlier ticket whose write set overlaps its own, also in one line', () => {
  const plan = planWith([
    { key: 'a', touches: ['src/a.ts'] },
    { key: 'b', depends_on: ['a'], touches: ['src/shared.ts'] },
    { key: 'c', depends_on: ['a'], touches: ['src/shared.ts', 'src/c.ts'] },
    { key: 'd', depends_on: ['a'], touches: ['src/d.ts'] },
  ]);
  for (const line of [false, true]) {
    const { needs, errors } = validatePlan(plan, 10, { line });
    assert.deepEqual(errors, []);
    assert.deepEqual(needs!.get('c'), ['a', 'b']);
    assert.deepEqual(needs!.get('d'), ['a']);
  }
});

test('names the files three or more tickets change as shared hotspots', () => {
  const tickets = [
    { key: 'a', touches: ['src/errors.py', 'src/a.py'] },
    { key: 'b', touches: ['./src/errors.py'] },
    { key: 'c', touches: ['src/errors.py', 'src/a.py', 'generated:idl/spec.json'] },
    { key: 'd', touches: ['generated:idl/spec.json', 'src/d.py'] },
    { key: 'e', touches: ['generated:idl/spec.json'] },
  ];
  assert.deepEqual(sharedHotspots(tickets), [{ path: 'src/errors.py', keys: ['a', 'b', 'c'] }]);
  assert.match(renderStacking(tickets.map((t) => ({ ...t, dependsOn: [] })), tickets.map((t) => ({ key: t.key, dependsOn: [] })), 4), /- src\/errors\.py: a, b, c/);
});
