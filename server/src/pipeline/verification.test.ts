import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gateResult, parseAcceptance, reviewComment } from './verification.ts';

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

const facts = { gate: 'PASS', verdict: 'CHANGES', round: 2, acceptance: null };

const changes = `VERDICT: CHANGES

## Summary
- Duplicate invites slip through.

## Acceptance
None.

## Findings
### R2.1 [major] src/invites.ts:52 — Duplicate invite returns 200 instead of 409
- Failure scenario: inviting the same email twice inserts a second row.
- Evidence: traced \`createInvite\` from \`routes/invites.ts:14\`; no lookup before insert.
- Suggested fix: call \`findInvite\` before the insert and return 409.

### R2.2 [nit] \`src/invites.ts:60\` — \`inv\` is an unclear name
- Suggested fix: rename it to \`invite\`.

## Previous findings
- R1.1: fixed

## Notes
The mailer retries look fine.
`;

test('reviewComment puts the verdict, checks and acceptance on one line', () => {
  const approve = 'VERDICT: APPROVE\n\n## Summary\n- ok\n\n## Findings\nNone.\n';
  assert.equal(reviewComment(approve, { ...facts, verdict: 'APPROVE', acceptance: { met: 3, unmet: 0, unverified: 1 } }), '**Review round 2: APPROVE** · checks passed · acceptance 3/4 met, 1 unverified');
  assert.equal(reviewComment(approve, { ...facts, verdict: 'APPROVE', gate: 'FAIL' }), '**Review round 2: APPROVE** · checks failed');
  assert.equal(reviewComment(approve, { ...facts, verdict: 'APPROVE', gate: null }), '**Review round 2: APPROVE**');
});

test('reviewComment lists each finding as claim, scenario and fix, and nothing written for agents', () => {
  assert.equal(
    reviewComment(changes, facts),
    [
      '**Review round 2: CHANGES** · checks passed',
      '',
      '1. **major** `src/invites.ts:52` — Duplicate invite returns 200 instead of 409',
      '   Inviting the same email twice inserts a second row. Fix: call `findInvite` before the insert and return 409.',
      '2. **nit** `src/invites.ts:60` — `inv` is an unclear name',
      '   Fix: rename it to `invite`.',
    ].join('\n'),
  );
  for (const agentOnly of ['Evidence', 'traced', 'Previous findings', 'R1.1', 'R2.1', 'mailer', 'Summary', 'slip through']) {
    assert.ok(!reviewComment(changes, facts).includes(agentOnly), agentOnly);
  }
});

test('reviewComment keeps a finding whose header has no severity or location', () => {
  const md = 'VERDICT: CHANGES\n\n## Findings\n### The migration drops the `email` column\n- Suggested fix: keep it.\n';
  assert.match(reviewComment(md, facts), /\n\n1\. The migration drops the `email` column\n {3}Fix: keep it\.$/);
});

test('reviewComment falls back to the findings as written when they are not in the expected shape', () => {
  const md = 'VERDICT: CHANGES\n\n## Findings\n- `a.ts:3` loses the error\n\n## Notes\nx\n';
  assert.equal(reviewComment(md, facts), '**Review round 2: CHANGES** · checks passed\n\n- `a.ts:3` loses the error');
});
