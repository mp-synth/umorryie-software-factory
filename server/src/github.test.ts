import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMENT_PREFIX, FACTORY_MARKER, factoryCommentBody, ciStateOf, humanChecksFrom, splitFailingChecks, type CheckRun } from './github.ts';

test('starts every factory comment with the automation prefix and keeps the loop marker', () => {
  const body = factoryCommentBody('Fixed the lint error.');
  assert.ok(body.includes(FACTORY_MARKER));
  assert.equal(body.split('\n').find((line) => line !== FACTORY_MARKER), COMMENT_PREFIX);
  assert.ok(body.endsWith('Fixed the lint error.'));
});

const run = (name: string, workflowName: string, conclusion: string, runId: number, startedAt = '2026-01-01T10:00:00Z'): CheckRun => ({
  name,
  workflowName,
  conclusion,
  status: conclusion ? 'COMPLETED' : 'IN_PROGRESS',
  startedAt,
  detailsUrl: `https://github.com/o/r/actions/runs/${runId}/job/${runId}1`,
});

const failingNames = (checks: CheckRun[]) => splitFailingChecks(checks).failing.map((c) => c.name);

test('drops a cancelled check when the same check succeeded on the same head', () => {
  const checks = [run('plan', 'Terragrunt', 'CANCELLED', 1), run('plan', 'Terragrunt', 'SUCCESS', 2)];
  assert.deepEqual(failingNames(checks), []);
  assert.deepEqual(splitFailingChecks(checks).superseded.map((c) => c.name), ['plan']);
});

test('drops a cancelled check when a newer run of the workflow has no failing entry', () => {
  const checks = [run('plan a', 'Terragrunt', 'CANCELLED', 1), run('plan b', 'Terragrunt', 'SUCCESS', 2), run('lint', 'Lint', 'SUCCESS', 3)];
  assert.deepEqual(failingNames(checks), []);
});

test('keeps a lone cancelled check and a cancelled check superseded only by an older run', () => {
  assert.deepEqual(failingNames([run('plan', 'Terragrunt', 'CANCELLED', 1)]), ['plan']);
  assert.deepEqual(failingNames([run('plan a', 'Terragrunt', 'CANCELLED', 2), run('plan b', 'Terragrunt', 'SUCCESS', 1)]), ['plan a']);
});

test('keeps a real failure even when a newer run of its workflow succeeded', () => {
  const checks = [run('test', 'CI', 'FAILURE', 1), run('lint', 'CI', 'SUCCESS', 2), run('test', 'CI', 'TIMED_OUT', 1)];
  assert.deepEqual(failingNames(checks), ['test', 'test']);
});

test('uses the start time when a check has no run id', () => {
  const bare = (conclusion: string, startedAt: string): CheckRun => ({ name: 'build', workflowName: 'CI', conclusion, startedAt });
  assert.deepEqual(failingNames([bare('CANCELLED', '2026-01-01T10:00:00Z'), { ...bare('SUCCESS', '2026-01-01T11:00:00Z'), name: 'other' }]), []);
});

test('treats a rerun that is still in progress as superseding', () => {
  assert.deepEqual(failingNames([run('plan', 'Terragrunt', 'CANCELLED', 1), run('plan', 'Terragrunt', '', 2)]), []);
});

test('derives the CI state of a PR, red before pending before green', () => {
  const failing = [{ name: 'test', url: null }];
  assert.equal(ciStateOf({ failingChecks: failing, pendingChecks: ['lint'], finishedChecks: 2 }), 'red');
  assert.equal(ciStateOf({ failingChecks: [], pendingChecks: ['lint'], finishedChecks: 2 }), 'pending');
  assert.equal(ciStateOf({ failingChecks: [], pendingChecks: [], finishedChecks: 2 }), 'green');
  assert.equal(ciStateOf({ failingChecks: [], pendingChecks: [], finishedChecks: 0 }), 'none');
});

test('lists the checks only people turn green that still wait, newest run per name', () => {
  const checks = humanChecksFrom([
    { name: 'Code review gate', bucket: 'fail', startedAt: '2026-01-01T10:00:00Z' },
    { name: 'Code review gate', bucket: 'pass', startedAt: '2026-01-01T11:00:00Z' },
    { name: 'Code review', bucket: 'pending', description: 'needs review from @growth', link: 'https://x/1' },
    { name: 'Meticulous Tests', bucket: 'fail', description: 'Visual differences in 3 of 90 screens' },
    { name: 'Meticulous Checks', bucket: 'pass' },
    { name: 'lint', bucket: 'fail' },
  ]);
  assert.deepEqual(checks, [
    { name: 'Code review', state: 'pending', description: 'needs review from @growth', url: 'https://x/1' },
    { name: 'Meticulous Tests', state: 'failing', description: 'Visual differences in 3 of 90 screens', url: null },
  ]);
});
