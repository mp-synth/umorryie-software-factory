import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReport, renderJson, renderMarkdown, type TaskResult } from './report.ts';

const arms = [
  { id: 'A', label: 'agents/reviewer.md' },
  { id: 'B', label: '/tmp/variant.md' },
];

let seq = 0;
const result = (caseName: string, arm: string, repeat: number, status: TaskResult['status'], defectKind: string | null, patch: Partial<TaskResult> = {}): TaskResult => ({
  taskId: `${caseName}.r${repeat}.${arm}.${seq++}`,
  caseName,
  repeat,
  arm,
  defectKind,
  status,
  verdict: status === 'blocked' ? null : 'X',
  reason: status === 'blocked' ? 'timed out' : 'r',
  forbidden: [],
  costUsd: 0.25,
  durationMs: 60_000,
  ...patch,
});

const report = (results: TaskResult[], list = arms, planned = results.length) => buildReport({ role: 'review', model: 'opus', repeats: 2, planned, arms: list, results });

test('catch rate per defect kind and false-alarm rate per arm', () => {
  const r = report(
    [
      result('shipping', 'A', 1, 'pass', 'off-by-one'),
      result('shipping', 'A', 2, 'fail', 'off-by-one'),
      result('clean', 'A', 1, 'pass', null),
      result('clean', 'A', 2, 'fail', null),
    ],
    [arms[0]],
  );
  assert.deepEqual(r.arms[0].catchRates, { 'off-by-one': { hits: 1, total: 2, rate: 0.5 } });
  assert.deepEqual(r.arms[0].falseAlarm, { hits: 1, total: 2, rate: 0.5 });
  assert.equal(r.paired, null);
  assert.equal(r.headlineWithheld, false);
});

test('cost and duration are summed and averaged per arm', () => {
  const r = report([result('c', 'A', 1, 'pass', 'k', { costUsd: 0.2, durationMs: 30_000 }), result('c', 'A', 2, 'pass', 'k', { costUsd: 0.4, durationMs: 90_000 })], [arms[0]]);
  assert.ok(Math.abs(r.arms[0].costUsd - 0.6) < 1e-9);
  assert.ok(Math.abs(r.arms[0].meanCostUsd! - 0.3) < 1e-9);
  assert.equal(r.arms[0].meanDurationSec, 60);
});

test('a blocked task withholds every headline number and lists the blocked tasks', () => {
  const r = report([result('shipping', 'A', 1, 'pass', 'off-by-one'), result('shipping', 'B', 1, 'blocked', 'off-by-one'), result('clean', 'A', 1, 'pass', null), result('clean', 'B', 1, 'pass', null)]);
  assert.equal(r.headlineWithheld, true);
  assert.equal(r.blocked.length, 1);
  assert.equal(r.blocked[0].arm, 'B');
  for (const a of r.arms) {
    assert.equal(a.catchRates, null);
    assert.equal(a.falseAlarm, null);
  }
  assert.equal(r.paired, null);
  assert.equal(r.saturated, null);
  assert.equal(r.flaky, null);
  const md = renderMarkdown(r);
  assert.match(md, /Headline withheld: 1 blocked tasks/);
  assert.match(md, /timed out/);
  assert.doesNotMatch(md, /Catch rate by defect kind/);
  assert.equal(JSON.parse(renderJson(r)).headlineWithheld, true);
});

test('fewer results than planned withhold the headline and count the missing tasks', () => {
  const r = report([result('shipping', 'A', 1, 'pass', 'off-by-one'), result('clean', 'A', 1, 'pass', null)], [arms[0]], 4);
  assert.equal(r.headlineWithheld, true);
  assert.equal(r.planned, 4);
  assert.equal(r.arms[0].catchRates, null);
  assert.equal(r.blocked.length, 0);
  const md = renderMarkdown(r);
  assert.match(md, /Headline withheld: 2 missing tasks/);
  assert.match(md, /2 of 4 planned tasks ran/);
  assert.doesNotMatch(md, /Catch rate by defect kind/);
});

test('blocked and missing tasks are both named in the withheld heading', () => {
  const md = renderMarkdown(report([result('shipping', 'A', 1, 'blocked', 'off-by-one')], [arms[0]], 3));
  assert.match(md, /Headline withheld: 1 blocked tasks, 2 missing tasks/);
});

test('the paired difference counts only pairs in which both arms have a graded result', () => {
  const r = report([
    result('shipping', 'A', 1, 'fail', 'off-by-one'),
    result('shipping', 'B', 1, 'pass', 'off-by-one'),
    result('shipping', 'A', 2, 'pass', 'off-by-one'),
    result('shipping', 'B', 2, 'pass', 'off-by-one'),
    result('invite', 'A', 1, 'pass', 'missing-await'),
    result('invite', 'B', 1, 'fail', 'missing-await'),
    result('invite', 'A', 2, 'pass', 'missing-await'),
    result('clean', 'A', 1, 'pass', null),
    result('clean', 'B', 1, 'fail', null),
  ]);
  assert.deepEqual(r.paired!.catch, { pairs: 3, hitsA: 2, hitsB: 2, onlyA: 1, onlyB: 1, difference: 0 });
  assert.deepEqual(r.paired!.falseAlarm, { pairs: 1, hitsA: 0, hitsB: 1, onlyA: 0, onlyB: 1, difference: 1 });
  assert.match(renderMarkdown(r), /Catch: 3 pairs/);
});

test('saturated cases passed in every repeat of every arm, flaky cases disagree within an arm', () => {
  const r = report([
    result('easy', 'A', 1, 'pass', 'k1'),
    result('easy', 'A', 2, 'pass', 'k1'),
    result('easy', 'B', 1, 'pass', 'k1'),
    result('easy', 'B', 2, 'pass', 'k1'),
    result('shaky', 'A', 1, 'pass', 'k2'),
    result('shaky', 'A', 2, 'fail', 'k2'),
    result('shaky', 'B', 1, 'fail', 'k2'),
    result('shaky', 'B', 2, 'fail', 'k2'),
    result('hard', 'A', 1, 'fail', 'k3'),
    result('hard', 'A', 2, 'fail', 'k3'),
    result('hard', 'B', 1, 'fail', 'k3'),
    result('hard', 'B', 2, 'fail', 'k3'),
  ]);
  assert.deepEqual(r.saturated, ['easy']);
  assert.deepEqual(r.flaky, [{ caseName: 'shaky', arm: 'A' }]);
  const md = renderMarkdown(r);
  assert.match(md, /Saturated .*: easy/);
  assert.match(md, /Flaky .*: shaky \(arm A\)/);
});

test('the markdown has a catch table, the false-alarm rate and the cost table', () => {
  const md = renderMarkdown(report([result('shipping', 'A', 1, 'pass', 'off-by-one'), result('clean', 'A', 1, 'pass', null)], [arms[0]]));
  assert.match(md, /\| off-by-one \| 1\/1 \(100%\) \|/);
  assert.match(md, /False-alarm rate \| 0\/1 \(0%\)/);
  assert.match(md, /Total cost/);
});
