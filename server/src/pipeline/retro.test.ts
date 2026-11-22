import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Message, Run } from '@factory/shared';
import { hasHumanPrItems, isSteering, parseProposedRules, renderProjectRules, renderTimeline, retroSummary, withLearnedRule, withoutLearnedRule } from './retro.ts';

const msg = (author: Message['author'], kind: Message['kind'], body: string, runId: string | null = null, createdAt = '2026-11-22T10:00:00Z') => ({ author, kind, body, runId, createdAt });
const routed = new Set(['steer-run']);

test('what the owner says or does by hand is steering', () => {
  assert.equal(isSteering(msg('human', 'feedback', 'Use the shared client'), routed), true);
  assert.equal(isSteering(msg('human', 'comment', 'This naming is off'), routed), true);
  assert.equal(isSteering(msg('human', 'event', 'Marked [02] Add X as approved.'), routed), true);
  assert.equal(isSteering(msg('human', 'approval', 'Approved the plan. Keep the API unchanged.'), routed), true);
});

test('questions, plain approvals, merges and agent chatter are not steering', () => {
  assert.equal(isSteering(msg('human', 'question', 'Why is this here?'), routed), false);
  assert.equal(isSteering(msg('human', 'approval', 'Approved the plan.'), routed), false);
  assert.equal(isSteering(msg('human', 'event', 'Marked [02] Add X as merged.'), routed), false);
  assert.equal(isSteering(msg('agent', 'feedback', 'Arbiter sent it back', 'arbiter-run'), routed), false);
  assert.equal(isSteering(msg('system', 'comment', 'PR merged'), routed), false);
});

test('feedback a router passed on from the owner counts as steering', () => {
  assert.equal(isSteering(msg('agent', 'feedback', 'Routed here', 'steer-run'), routed), true);
});

test('PR items from people count; bot threads and bot comments do not', () => {
  const bot = { prNumber: 1, threads: [{ label: 'T1', id: 'a', rootCommentId: 1, rootAuthor: 'cursor[bot]', rootIsBot: true }], comments: [{ label: 'C1', url: 'u', author: 'github-actions[bot]' }] };
  assert.equal(hasHumanPrItems(bot), false);
  assert.equal(hasHumanPrItems({ ...bot, comments: [{ label: 'C1', url: 'u', author: 'alice' }] }), true);
  assert.equal(hasHumanPrItems({ ...bot, threads: [{ label: 'T1', id: 'a', rootCommentId: 1, rootAuthor: 'bob' }] }), true);
  assert.equal(hasHumanPrItems(null), false);
});

test('the timeline interleaves steps and steering in time order', () => {
  const run = (kind: Run['kind'], queuedAt: string, verdict: string | null, trigger: Run['trigger'] = 'auto') =>
    ({ kind, round: 1, trigger, model: 'opus', status: 'succeeded', verdict, queuedAt, outputPath: `/tmp/${kind}.md`, error: null }) as const;
  const md = renderTimeline(
    'Timeline of [01] X',
    [run('execute', '2026-11-22T09:00:00Z', 'STATUS: READY'), run('fix', '2026-11-22T11:00:00Z', 'FIX: APPLIED', 'manual')],
    [msg('human', 'feedback', 'Rename foo to bar', null, '2026-11-22T10:00:00Z'), msg('agent', 'comment', 'Fix round 2 done', 'x', '2026-11-22T11:30:00Z')],
    routed,
  );
  const lines = md.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /executor, round 1 · auto · opus · STATUS: READY/);
  assert.match(lines[1], /\*\*Owner \(feedback\)\*\*/);
  assert.match(md, /> Rename foo to bar/);
  assert.match(lines[2], /fixer, round 1 · started by the owner/);
});

const retro = `RETRO: RULES

## Summary
The owner had to ask twice for the shared HTTP client.

## Steering
1. "Use the shared client" → executor, rule missing.

## Rules
### Rule 1
Scope: project
Role: code
Rule: Call external APIs through \`http/client.ts\`;
  never construct \`fetch\` calls inline.
Why: 1

### Rule 2
Scope: everywhere
Role: executor
Rule: Something.
Why: 1

### Rule 3
**Scope:** factory
**Role:** \`reviewer\`
**Rule:** Flag every new inline fetch.
**Why:** 1
`;

test('proposed rules are parsed, joined onto one line and validated', () => {
  const { rules, dropped } = parseProposedRules(retro);
  assert.deepEqual(rules, [
    { scope: 'project', role: 'code', body: 'Call external APIs through `http/client.ts`; never construct `fetch` calls inline.', why: '1' },
    { scope: 'factory', role: 'reviewer', body: 'Flag every new inline fetch.', why: '1' },
  ]);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /unknown scope "everywhere"/);
  assert.equal(retroSummary(retro), 'The owner had to ask twice for the shared HTTP client.');
});

test('a retro without rules proposes nothing', () => {
  assert.deepEqual(parseProposedRules('RETRO: NO-RULES\n\n## Summary\nNothing to learn.'), { rules: [], dropped: [] });
});

test('no more than three rules are kept from one retro', () => {
  const many = ['RETRO: RULES', '', '## Rules', ...[1, 2, 3, 4].flatMap((n) => [`### Rule ${n}`, 'Scope: project', 'Role: all', `Rule: Rule number ${n}.`, ''])].join('\n');
  const { rules, dropped } = parseProposedRules(many);
  assert.equal(rules.length, 3);
  assert.match(dropped[0], /more than 3 rules/);
});

test('an accepted rule lands under one Learned rules section, once', () => {
  const role = '---\nname: x\n---\n\nDo the job.\n\nWhen you are done, reply with one line.\n';
  const once = withLearnedRule(role, 'First rule.');
  assert.match(once, /reply with one line\.\n\n## Learned rules\n\n.*\n\n- First rule\.\n$/);
  const twice = withLearnedRule(once, 'Second\nrule.');
  assert.match(twice, /- First rule\.\n- Second rule\.\n$/);
  assert.equal(withLearnedRule(twice, 'First rule.'), twice);
  assert.equal(twice.match(/## Learned rules/g)!.length, 1);
});

test('a learned rule goes into its section even when a later section follows', () => {
  const role = '# Role\n\n## Learned rules\n\nIntro.\n\n- Old rule.\n\n## Output\n\nWrite it.\n';
  assert.equal(withLearnedRule(role, 'New rule.'), '# Role\n\n## Learned rules\n\nIntro.\n\n- Old rule.\n- New rule.\n\n## Output\n\nWrite it.\n');
});

test('retiring a rule removes exactly its line', () => {
  const content = withLearnedRule(withLearnedRule('Role.\n', 'Keep me.'), 'Drop me.');
  const after = withoutLearnedRule(content, 'Drop me.');
  assert.ok(after.includes('- Keep me.'));
  assert.ok(!after.includes('Drop me.'));
});

test('project rules render as one section, or nothing when there are none', () => {
  assert.equal(renderProjectRules([]), null);
  assert.match(renderProjectRules([{ body: 'A.' }, { body: 'B.' }])!, /^## Rules learned in this project\n[\s\S]*- A\.\n- B\.$/);
});
