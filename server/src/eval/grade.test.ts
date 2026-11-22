import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvalCase } from './fixtures.ts';
import { forbiddenCommands, gradeTask } from './grade.ts';

const defect: EvalCase = { name: 'd', role: 'review', expected: 'CHANGES', defectKind: 'off-by-one', defectFile: 'src/shipping.js', markers: ['qualifiesForFreeShipping'] };
const control: EvalCase = { name: 'c', role: 'review', expected: 'APPROVE', defectKind: null, defectFile: null, markers: [] };
const block: EvalCase = { name: 'v', role: 'verify', expected: 'BLOCK', defectKind: 'unrelated-edit', defectFile: 'src/store.js', markers: ['sort'] };

const bash = (command: string) => ({ type: 'tool_use' as const, data: { name: 'Bash', input: { command } } });
const ok = (output: string | null, events = []) => ({ output, error: null, events });

test('a defect case passes when the verdict matches and the file is named in the findings', () => {
  const g = gradeTask(defect, ok('VERDICT: CHANGES\n\n## Findings\n### R1.1 [major] src/shipping.js:4 — off by one'));
  assert.equal(g.status, 'pass');
  assert.equal(g.verdict, 'CHANGES');
});

test('a defect case fails when the verdict is right but the file is not named', () => {
  const g = gradeTask(defect, ok('VERDICT: CHANGES\n\n## Findings\n### R1.1 [major] src/other.js:4 — something'));
  assert.equal(g.status, 'fail');
  assert.match(g.reason, /src\/shipping\.js/);
});

test('a defect case fails when the file is only mentioned outside the findings', () => {
  const output = 'VERDICT: CHANGES\n\n## Summary\n- read src/shipping.js\n\n## Acceptance\n| a | met | src/shipping.js:2 |\n\n## Findings\n### R1.1 [major] src/other.js:4 — something';
  assert.equal(gradeTask(defect, ok(output)).status, 'fail');
});

test('a declared marker in the findings passes without the file name, case-insensitively', () => {
  const g = gradeTask(defect, ok('VERDICT: CHANGES\n\n## Findings\n### R1.1 [major] src/other.js:4 — QUALIFIESFORFREESHIPPING rejects 5000'));
  assert.equal(g.status, 'pass');
});

test('a marker only outside the findings does not count', () => {
  assert.equal(gradeTask(defect, ok('VERDICT: CHANGES\n\n## Summary\n- qualifiesForFreeShipping\n\n## Findings\nNone.')).status, 'fail');
});

test('a defect case fails when the judge approves', () => {
  const g = gradeTask(defect, ok('VERDICT: APPROVE\n\nsrc/shipping.js looks fine'));
  assert.equal(g.status, 'fail');
  assert.equal(g.reason, 'expected CHANGES, got APPROVE');
});

test('a control passes on APPROVE without mentioning any file and fails on CHANGES', () => {
  assert.equal(gradeTask(control, ok('VERDICT: APPROVE\n\nNone.')).status, 'pass');
  assert.equal(gradeTask(control, ok('VERDICT: CHANGES\n\nsrc/pricing.js')).status, 'fail');
});

test('a verify case uses the verify verdicts', () => {
  assert.equal(gradeTask(block, ok('VERDICT: BLOCK\n\n## Findings\n- abc1234: src/store.js changed')).status, 'pass');
  assert.equal(gradeTask(block, ok('VERDICT: BLOCK\n\n## Reason\nThe fix also sorts the rows.\n\n## Findings\nNone.')).status, 'pass');
  assert.equal(gradeTask(block, ok('VERDICT: BLOCK\n\n## Summary\n- src/store.js\n\n## Findings\n- abc1234: other')).status, 'fail');
  assert.equal(gradeTask(block, ok('VERDICT: CHANGES\n\nsrc/store.js')).status, 'blocked');
});

test('an errored or timed out agent, missing output or a malformed verdict is blocked', () => {
  assert.equal(gradeTask(defect, { output: 'VERDICT: CHANGES src/shipping.js', error: 'timed out', events: [] }).status, 'blocked');
  assert.equal(gradeTask(defect, { output: null, error: 'agent ended with an error', events: [] }).reason, 'agent ended with an error');
  assert.equal(gradeTask(defect, ok(null)).status, 'blocked');
  assert.equal(gradeTask(defect, ok('Looks good to me')).status, 'blocked');
  assert.match(gradeTask(defect, ok('VERDICT: MAYBE')).reason, /malformed verdict/);
});

test('forbidden commands are test runners, pushes and commits, found inside command chains', () => {
  const found = forbiddenCommands([
    bash('npm test'),
    bash('cd /tmp/x && node --test test/a.test.js'),
    bash('CI=1 pnpm run test -- --watch=false'),
    bash('git push origin HEAD'),
    bash('git -c user.name=x commit -m wip'),
    bash('git diff main...HEAD | head -50'),
    bash('node --check src/a.js'),
    bash('cat test/a.test.js'),
    bash('grep -rn "npm test" .'),
    { type: 'text' as const, data: { text: 'npm test' } },
  ]);
  assert.deepEqual(found.map((f) => f.kind), ['test-runner', 'test-runner', 'test-runner', 'git-push', 'commit']);
});

test('forbidden commands are recorded on the grade without changing it', () => {
  const g = gradeTask(control, { output: 'VERDICT: APPROVE', error: null, events: [bash('npm test')] });
  assert.equal(g.status, 'pass');
  assert.equal(g.forbidden.length, 1);
});
