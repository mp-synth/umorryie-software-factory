import assert from 'node:assert/strict';
import { test } from 'node:test';
import { malformedVerdictReason, outputFailure, parseVerdict, VERDICTS, type VerdictKind } from './verdict.ts';

const kinds = Object.keys(VERDICTS) as VerdictKind[];

test('accepts the canonical line for every kind and token', () => {
  for (const kind of kinds) {
    const { prefix, tokens } = VERDICTS[kind];
    for (const token of tokens) assert.equal(parseVerdict(kind, `${prefix}: ${token}\n\n## Summary\n- x`), token);
  }
});

test('rejects anything after the token but trailing whitespace', () => {
  assert.equal(parseVerdict('review', 'VERDICT: CHANGES - cannot APPROVE'), null);
  assert.equal(parseVerdict('review', 'VERDICT: APPROVE | CHANGES'), null);
  assert.equal(parseVerdict('plan_review', 'VERDICT: PASS | REVISE'), null);
  assert.equal(parseVerdict('verify', 'VERDICT: APPROVE | BLOCK'), null);
  assert.equal(parseVerdict('review', 'VERDICT: APPROVE_WITH_NITS'), null);
  assert.equal(parseVerdict('review', 'VERDICT: APPROVE2'), null);
  assert.equal(parseVerdict('review', 'VERDICT: APPROVE but fix the typo'), null);
  assert.equal(parseVerdict('fix', 'FIX: APPLIED (2 commits)'), null);
  assert.equal(parseVerdict('review', 'VERDICT: APPROVE   \n\nbody'), 'APPROVE');
});

test('is case-insensitive and tolerates spacing', () => {
  assert.equal(parseVerdict('review', 'verdict:approve'), 'APPROVE');
  assert.equal(parseVerdict('review', 'Verdict:   Approve'), 'APPROVE');
});

test('tolerates leading blank lines and heading marks like firstLine does', () => {
  assert.equal(parseVerdict('plan', '\n\n# PLAN: READY\n\nbody'), 'READY');
  assert.equal(parseVerdict('execute', '\n## STATUS: BLOCKED'), 'BLOCKED');
});

test('rejects tokens run on to more letters or hyphens', () => {
  assert.equal(parseVerdict('review', 'VERDICT: APPROVE-able'), null);
  assert.equal(parseVerdict('review', 'VERDICT: APPROVED'), null);
  assert.equal(parseVerdict('execute', 'STATUS: UNBLOCKED'), null);
  assert.equal(parseVerdict('fix', 'FIX: NO-CHANGES-NEEDED'), null);
  assert.equal(parseVerdict('fix', 'FIX: NOTHING'), null);
});

test('rejects empty text, the wrong prefix for the kind and unknown tokens', () => {
  assert.equal(parseVerdict('review', ''), null);
  assert.equal(parseVerdict('review', null), null);
  assert.equal(parseVerdict('review', undefined), null);
  assert.equal(parseVerdict('review', '\n  \n'), null);
  assert.equal(parseVerdict('review', 'STATUS: APPROVE'), null);
  assert.equal(parseVerdict('plan_review', 'VERDICT: APPROVE'), null);
  assert.equal(parseVerdict('verify', 'VERDICT: CHANGES'), null);
  assert.equal(parseVerdict('review', 'VERDICT: MAYBE'), null);
  assert.equal(parseVerdict('review', 'APPROVE'), null);
  assert.equal(parseVerdict('review', 'The verdict: APPROVE'), null);
  assert.equal(parseVerdict('review', 'VERDICT: '), null);
});

test('only the first non-empty line counts', () => {
  assert.equal(parseVerdict('review', 'Looks fine\nVERDICT: APPROVE'), null);
});

test('describes a malformed verdict with the first line cut to 120 characters', () => {
  assert.equal(malformedVerdictReason('\n# oops\nmore'), 'malformed verdict: "oops"');
  assert.equal(malformedVerdictReason(null), 'malformed verdict: ""');
  assert.equal(malformedVerdictReason('x'.repeat(200)), `malformed verdict: "${'x'.repeat(120)}"`);
});

const ok = { isError: false, subtype: null, resultText: null, stderrTail: '' };

test('a clean result with output is not a failure', () => {
  assert.equal(outputFailure(ok, 'VERDICT: APPROVE', 'review.md'), null);
});

test('a clean result without output names the missing file', () => {
  assert.equal(outputFailure(ok, null, 'review.md'), 'agent did not write review.md');
  assert.equal(outputFailure(ok, '', 'review.md'), 'agent did not write review.md');
});

test('an error result fails even when the output file was written', () => {
  const failed = { ...ok, isError: true, subtype: 'error_max_turns', resultText: ' ran out of turns ' };
  assert.equal(outputFailure(failed, 'VERDICT: APPROVE', 'review.md'), 'agent ended with an error (error_max_turns): ran out of turns');
  assert.equal(outputFailure(failed, null, 'review.md'), 'agent ended with an error (error_max_turns): ran out of turns');
});

test('an error without a result event falls back to stderr, then to unknown', () => {
  assert.equal(outputFailure({ ...ok, isError: true, stderrTail: 'boom\n' }, 'x', 'plan.md'), 'agent ended with an error: boom');
  assert.equal(outputFailure({ ...ok, isError: true }, 'x', 'plan.md'), 'agent ended with an error: unknown');
});
