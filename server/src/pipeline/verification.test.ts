import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gateResult, parseAcceptance, renderVerification, verifiedFixRounds } from './verification.ts';

const review = (table: string) => `VERDICT: APPROVE\n\n## Summary\n- ok\n\n## Acceptance\n${table}\n\n## Findings\nNone.\n`;

test('parseAcceptance counts a well-formed table', () => {
  const md = review(
    ['| Check | Result | Evidence |', '| --- | --- | --- |', '| a | met | x.ts:1 |', '| b | unmet | y.ts:2 |', '| c | unverified | needs the app |', '| d | met | z.ts:3 |'].join('\n'),
  );
  assert.deepEqual(parseAcceptance(md), { met: 2, unmet: 1, unverified: 1 });
});

test('parseAcceptance tolerates extra columns, capitalisation and decoration', () => {
  const md = review(['| # | Check | RESULT | Evidence | Notes |', '|:-:|---|:-:|---|---|', '| 1 | a | **Met** | x | |', '| 2 | b | Unverified. | y | |'].join('\n'));
  assert.deepEqual(parseAcceptance(md), { met: 1, unmet: 0, unverified: 1 });
});

test('parseAcceptance returns null when the section is missing, empty or unparseable', () => {
  assert.equal(parseAcceptance('VERDICT: APPROVE\n\n## Summary\n- ok\n'), null);
  assert.equal(parseAcceptance(null), null);
  assert.equal(parseAcceptance(review('None.')), null);
  assert.equal(parseAcceptance(review('| Check | Verdict |\n| - | - |\n| a | met |')), null);
  assert.equal(parseAcceptance(review('| Check | Result |\n| - | - |\n| a | maybe |')), null);
});

test('parseAcceptance reads the first word of the result cell and skips the header and separator rows', () => {
  const md = review(['| Check | Result | Evidence |', '| - | - | - |', '| a | unmet (see R1.2) | x |', '| b | `met` - checked | y |', '| c | Unverified: no app | z |'].join('\n'));
  assert.deepEqual(parseAcceptance(md), { met: 1, unmet: 1, unverified: 1 });
});

test('parseAcceptance copes with a pipe inside another cell', () => {
  const md = review(['| Check | Result | Evidence |', '| - | - | - |', '| a | met | x.ts:1 | y.ts:2 |', '| b \\| c | unmet | y |'].join('\n'));
  assert.deepEqual(parseAcceptance(md), { met: 1, unmet: 1, unverified: 0 });
});

test('parseAcceptance returns null when any data row has no result', () => {
  assert.equal(parseAcceptance(review(['| Check | Result |', '| - | - |', '| a | met |', '| b |', '| c | unmet |'].join('\n'))), null);
  assert.equal(parseAcceptance(review(['| Check | Result |', '| - | - |', '| a | met |', '| c | partly |'].join('\n'))), null);
});

test('gateResult reads the gate verdict line', () => {
  assert.equal(gateResult('GATE: PASS'), 'PASS');
  assert.equal(gateResult('GATE: skipped'), 'SKIPPED');
  assert.equal(gateResult('FIX: APPLIED'), null);
  assert.equal(gateResult(null), null);
});

test('verifiedFixRounds counts approved verifier runs only', () => {
  assert.equal(
    verifiedFixRounds([
      { kind: 'verify', outputMd: 'VERDICT: APPROVE\n\nok' },
      { kind: 'verify', outputMd: 'VERDICT: BLOCK\n\nno' },
      { kind: 'verify', outputMd: 'VERIFY: NOTHING-TO-DO' },
      { kind: 'review', outputMd: 'VERDICT: APPROVE' },
    ]),
    1,
  );
});

const base = { gate: { command: 'pnpm lint', result: 'PASS' }, verdict: 'APPROVE', round: 2, verifiedFixRounds: 0, acceptance: null };

test('renderVerification states each gate outcome', () => {
  for (const result of ['PASS', 'FAIL', 'SKIPPED']) {
    const out = renderVerification({ ...base, gate: { command: 'pnpm lint', result } });
    assert.match(out, new RegExp(`- Checks command \`pnpm lint\`: ${result}\n`));
  }
  assert.ok(renderVerification(base).startsWith('**Factory checks**\n\n'));
  assert.ok(renderVerification(base).endsWith("Not run here: tests. They run in this PR's CI."));
});

test('renderVerification omits the gate bullet without a gate run', () => {
  const out = renderVerification({ ...base, gate: null });
  assert.doesNotMatch(out, /Checks command/);
  assert.match(out, /- Review round 2: APPROVE/);
});

test('renderVerification shows acceptance counts only when present', () => {
  assert.doesNotMatch(renderVerification(base), /Acceptance/);
  const out = renderVerification({ ...base, acceptance: { met: 3, unmet: 0, unverified: 1 } });
  assert.match(out, /- Acceptance checks, as the reviewer read them: 3 met, 0 unmet, 1 unverified/);
});

test('renderVerification shows verified fix rounds only when there are any', () => {
  assert.doesNotMatch(renderVerification(base), /verifier/);
  const out = renderVerification({ ...base, verifiedFixRounds: 2 });
  assert.match(out, /- Fix rounds approved by a verifier: 2/);
  assert.ok(out.split('\n').filter((l) => l.startsWith('- ')).length <= 4);
});
