import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failingLines, gateBody } from './gate-output.ts';

const base = { command: 'pnpm check', code: 1, timedOut: false, seconds: 12, cwd: '/w', logPath: '/r/checks.log' };
const filler = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`);

test('short failing output has no failing lines section', () => {
  const body = gateBody({ ...base, output: 'a\nerror: boom\nb' });
  assert.ok(!body.includes('## Failing lines'));
  assert.ok(body.includes('## Output (last 200 lines)'));
  assert.ok(body.includes('exit 1 in 12s, run in /w'));
});

test('long failing output lists failing lines before the tail', () => {
  const output = [...filler(300), 'src/a.ts(1,1): error TS2345: bad', ...filler(300)].join('\n');
  const body = gateBody({ ...base, output });
  const failing = body.indexOf('## Failing lines');
  assert.ok(failing > 0);
  assert.ok(failing < body.indexOf('## Output (last 200 lines)'));
  assert.ok(body.slice(failing).includes('error TS2345'));
});

test('failing lines keep one line of context, de-duplicate and cap at 60', () => {
  assert.deepEqual(failingLines(['a', 'FAIL x', 'b', 'c']), ['a', 'FAIL x', 'b']);
  assert.deepEqual(failingLines(['FAIL x', 'FAIL x', 'FAIL x']), ['FAIL x']);
  const many = Array.from({ length: 500 }, (_, i) => `not ok ${i}`);
  assert.equal(failingLines(many).length, 60);
});

test('a passing run has no failing lines section', () => {
  const output = [...filler(300), 'error in a log line', ...filler(10)].join('\n');
  const body = gateBody({ ...base, code: 0, output });
  assert.ok(!body.includes('## Failing lines'));
});

test('the full log path and the search hint are present', () => {
  const body = gateBody({ ...base, code: 0, output: 'ok' });
  assert.ok(body.includes('/r/checks.log'));
  assert.ok(body.includes('instead of re-running the whole command'));
});
