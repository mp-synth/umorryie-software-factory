import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE_COMMIT_FIELD, header } from '../pipeline/role-prompt.ts';
import {
  agreement,
  baseCheckoutCommit,
  baseCommitOf,
  crossAgreement,
  fieldOf,
  inputsOf,
  outputPathOf,
  REPLAYABLE_KINDS,
  replayOrder,
  repointPrompt,
  utf8Text,
  verdictWord,
  worktreePathsIn,
} from './prompt.ts';

const PROMPT = [
  'Factory step: arbitrate. Initiative: X',
  'Base checkout (read-only): /h/.sf/worktrees/enact/_base/master-3df9f7175755',
  'Base commit: origin/master at 3df9f7175755, fetched just now. The main checkout may be older',
  'Worktree (read-only): /h/.sf/worktrees/enact/x-1/01-a',
  'Branch: factory/x/01-a',
  'Inputs:',
  '- /h/.sf/initiatives/x-1/plan/arbiter/7487/situation.md',
  '- /h/.sf/initiatives/x-1/brief.md',
  'Output: /h/.sf/initiatives/x-1/plan/arbiter/7487/decision.md',
  'Reply with one line: the first line of decision.md.',
].join('\n');

test('reads the output, the base commit, the inputs and named fields of a stored prompt', () => {
  assert.equal(outputPathOf(PROMPT), '/h/.sf/initiatives/x-1/plan/arbiter/7487/decision.md');
  assert.equal(baseCommitOf(PROMPT), '3df9f7175755');
  assert.deepEqual(inputsOf(PROMPT), ['/h/.sf/initiatives/x-1/plan/arbiter/7487/situation.md', '/h/.sf/initiatives/x-1/brief.md']);
  assert.equal(fieldOf(PROMPT, 'Worktree'), '/h/.sf/worktrees/enact/x-1/01-a');
  assert.equal(fieldOf(PROMPT, 'Branch'), 'factory/x/01-a');
  assert.equal(fieldOf(PROMPT, 'PR'), null);
});

test('reads back a prompt the factory writes', () => {
  const prompt = header(
    'Factory step: arbitrate. Initiative: X',
    [
      ['Base checkout (read-only)', '/h/.sf/worktrees/enact/_base/master-3df9f7175755'],
      [BASE_COMMIT_FIELD, 'origin/master at 3df9f7175755, fetched just now. The main checkout may be older'],
      ['Branch', 'factory/x/01-a'],
      ['PR', null],
    ],
    ['/i/situation.md', '/i/brief.md'],
    ['/i/decision.md'],
    'Reply with one line: the first line of decision.md.',
  );
  assert.equal(outputPathOf(prompt), '/i/decision.md');
  assert.deepEqual(inputsOf(prompt), ['/i/situation.md', '/i/brief.md']);
  assert.equal(baseCommitOf(prompt), '3df9f7175755');
  assert.equal(fieldOf(prompt, 'Base checkout'), '/h/.sf/worktrees/enact/_base/master-3df9f7175755');
  assert.equal(fieldOf(prompt, 'Branch'), 'factory/x/01-a');
  assert.equal(fieldOf(prompt, 'PR'), null);
  assert.deepEqual(inputsOf(header('t', [], [], ['/i/out.md'], 'r')), []);
});

test('replays only agent steps that write a single output', () => {
  assert.equal(outputPathOf(header('Factory step: plan.', [], [], ['/i/plan.md', '/i/plan.json'], 'r')), null);
  assert.ok(!REPLAYABLE_KINDS.includes('plan'));
  assert.ok(!(REPLAYABLE_KINDS as readonly string[]).includes('gate'));
  assert.ok(REPLAYABLE_KINDS.includes('arbitrate'));
});

test('reads valid UTF-8 as text and nothing else', () => {
  assert.equal(utf8Text(Buffer.from('{"cwd":"/w/Enact"} ✓\n')), '{"cwd":"/w/Enact"} ✓\n');
  assert.equal(utf8Text(Buffer.from('\ufeffbom')), '\ufeffbom');
  assert.equal(utf8Text(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe])), null);
});

test('points every path at the sandbox, the longest first', () => {
  const out = repointPrompt(PROMPT, [
    ['/h/.sf/initiatives/x-1', '/box/init'],
    ['/h/.sf/initiatives/x-1/plan', '/never'],
    ['/h/.sf/worktrees/enact/x-1/01-a', '/box/wt'],
  ]);
  assert.match(out, /Output: \/never\/arbiter\/7487\/decision\.md/);
  assert.match(out, /- \/box\/init\/brief\.md/);
  assert.match(out, /Worktree \(read-only\): \/box\/wt$/m);
});

test('takes the verdict word from a first line', () => {
  assert.equal(verdictWord('DECISION: APPROVE'), 'APPROVE');
  assert.equal(verdictWord('ROUTE: REPLAN'), 'REPLAN');
  assert.equal(verdictWord('VERDICT: PASS — fine'), 'PASS');
  assert.equal(verdictWord('no verdict'), null);
  assert.equal(verdictWord(null), null);
});

test('scores each arm against the original and against itself, and the arms against each other', () => {
  const original = new Map([['c1', 'APPROVE'], ['c2', 'RETRY']]);
  const outcomes = [
    { caseId: 'c1', arm: 'fable', verdict: 'APPROVE' },
    { caseId: 'c1', arm: 'fable', verdict: 'APPROVE' },
    { caseId: 'c2', arm: 'fable', verdict: 'RETRY' },
    { caseId: 'c2', arm: 'fable', verdict: 'APPROVE' },
    { caseId: 'c1', arm: 'opus', verdict: 'APPROVE' },
    { caseId: 'c1', arm: 'opus', verdict: null },
    { caseId: 'c2', arm: 'opus', verdict: 'APPROVE' },
    { caseId: 'c2', arm: 'opus', verdict: 'APPROVE' },
  ];
  const [fable, opus] = agreement(original, outcomes);
  assert.deepEqual(fable, { arm: 'fable', withOriginal: 0.75, selfConsistent: 0.5, replays: 4, failed: 0 });
  assert.deepEqual(opus, { arm: 'opus', withOriginal: 1 / 3, selfConsistent: 1, replays: 4, failed: 1 });
  // fable split 1:1 on c2; a tie goes to the verdict it reached first (RETRY), so the arms differ there
  assert.deepEqual(crossAgreement(outcomes, 'fable', 'opus'), { agree: 0.5, cases: 2, differ: ['c2'] });
  // one replay per case says nothing about consistency
  assert.equal(agreement(original, [{ caseId: 'c1', arm: 'opus', verdict: 'APPROVE' }])[0].selfConsistent, null);
});

test('runs every case once with each model before repeating, so a cut keeps whole cases', () => {
  const order = replayOrder(['a', 'b'], ['x', 'y'], 2).map((s) => `${s.c}${s.model}${s.repeat}`);
  assert.deepEqual(order, ['ax1', 'ay1', 'bx1', 'by1', 'ay2', 'ax2', 'by2', 'bx2']);
});

test('repoints whole paths only, never the start of a longer name', () => {
  const out = repointPrompt('Main: /w/Enact, old: /w/Enact-old, file: /w/Enact/a.py, `git -C /w/Enact diff`', [['/w/Enact', '/box/wt']]);
  assert.equal(out, 'Main: /box/wt, old: /w/Enact-old, file: /box/wt/a.py, `git -C /box/wt diff`');
});

test('finds the worktrees a text names, folding paths inside one onto it', () => {
  const text = [
    '- Worktree: /h/.sf/worktrees/enact/x-1/01-a (diff: `git -C /h/.sf/worktrees/enact/x-1/01-a diff b...HEAD`)',
    'see /h/.sf/worktrees/enact/x-1/02-b/src/app.py:12.',
    'Base checkout (read-only): /h/.sf/worktrees/enact/_base/master-3df9f7175755',
    'not a worktree: /h/.sf/worktrees/enact',
  ].join('\n');
  assert.deepEqual(worktreePathsIn(text, '/h/.sf'), [
    '/h/.sf/worktrees/enact/x-1/01-a',
    '/h/.sf/worktrees/enact/x-1/02-b',
    '/h/.sf/worktrees/enact/_base/master-3df9f7175755',
  ]);
  assert.equal(baseCheckoutCommit('/h/.sf/worktrees/enact/_base/master-3df9f7175755'), '3df9f7175755');
  assert.equal(baseCheckoutCommit('/h/.sf/worktrees/enact/x-1/01-a'), null);
});
