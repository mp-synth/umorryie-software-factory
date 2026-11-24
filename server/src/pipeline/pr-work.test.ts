import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrSnapshot, ReviewThread } from '../github.ts';
import { describeIgnored, describePrWork, hasPrWork, isBotCommand, isNoiseAuthor, prWorkFingerprint, prWorkFrom, reviewAfterFix } from './pr-work.ts';

const snapshot = (patch: Partial<PrSnapshot> = {}): PrSnapshot => ({
  number: 7,
  url: 'https://github.com/o/r/pull/7',
  state: 'OPEN',
  isDraft: true,
  mergeable: 'MERGEABLE',
  baseRefName: 'main',
  headRefOid: 'abc',
  failingChecks: [],
  supersededChecks: [],
  pendingChecks: [],
  finishedChecks: 0,
  comments: [],
  reviews: [],
  ...patch,
});

const thread = (id: string, patch: Partial<ReviewThread> = {}): ReviewThread => ({
  id,
  rootCommentId: 1,
  rootAuthor: 'alice',
  rootIsBot: false,
  path: 'src/a.ts',
  line: 3,
  outdated: false,
  awaitingReviewer: false,
  lastCommentAt: '2026-01-01T10:00:00Z',
  comments: [{ author: 'alice', body: 'rename this' }],
  ...patch,
});

const comment = (author: string, createdAt: string, url = `https://x/${author}/${createdAt}`) => ({ author, body: 'why?', createdAt, url });
const noiseCommentAuthors = ['github-actions', 'codecov'];
const fresh = { lastFixAt: null, noiseCommentAuthors };
const BUGBOT_SUMMARY = '<!-- BUGBOT_REVIEW -->\nCursor Bugbot has reviewed your changes and found 1 potential issue.';

test('a clean PR has nothing to act on', () => {
  assert.equal(hasPrWork(prWorkFrom(snapshot(), [], fresh)), false);
});

test('waits for CI to finish before acting on failing checks', () => {
  const failing = [{ name: 'lint', url: null }];
  assert.equal(hasPrWork(prWorkFrom(snapshot({ failingChecks: failing, pendingChecks: ['test'] }), [], fresh)), false);
  assert.equal(hasPrWork(prWorkFrom(snapshot({ failingChecks: failing }), [], fresh)), true);
});

test('skips threads that wait for their reviewer, and counts outdated ones with a reply after the last fix', () => {
  const threads = [
    thread('a', { awaitingReviewer: true }),
    thread('b', { outdated: true, lastCommentAt: '2026-01-01T12:00:00Z' }),
    thread('c', { outdated: true, lastCommentAt: '2026-01-01T09:00:00Z' }),
    thread('d'),
  ];
  assert.deepEqual(prWorkFrom(snapshot(), threads, { ...fresh, lastFixAt: Date.parse('2026-01-01T09:30:00Z') }).threads.map((t) => t.id), ['b', 'd']);
});

test('counts every author’s comment newer than the last fix, the owner’s included', () => {
  const snap = snapshot({
    comments: [comment('bob', '2026-01-01T10:00:00Z'), comment('factory-owner', '2026-01-01T11:00:00Z'), comment('bob', '2026-01-01T12:00:00Z')],
  });
  assert.deepEqual(prWorkFrom(snap, [], fresh).comments.map((c) => c.author), ['bob', 'factory-owner', 'bob']);
  const afterFix = prWorkFrom(snap, [], { ...fresh, lastFixAt: Date.parse('2026-01-01T10:30:00Z') });
  assert.deepEqual(afterFix.comments.map((c) => c.createdAt), ['2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z']);
  assert.equal(prWorkFrom(snap, [], { ...fresh, lastFixAt: Date.parse('2026-01-01T13:00:00Z') }).comments.length, 0);
});

test('counts a thread whose newest comment came after the last fix, whoever wrote it', () => {
  const owners = thread('mine', { rootAuthor: 'factory-owner', comments: [{ author: 'factory-owner', body: 'this is never used' }], lastCommentAt: '2026-01-01T12:00:00Z' });
  const work = prWorkFrom(snapshot(), [owners], { ...fresh, lastFixAt: Date.parse('2026-01-01T10:00:00Z') });
  assert.deepEqual(work.threads.map((t) => t.id), ['mine']);
});

test('keeps a thread the factory never answered after a fix that succeeded without a reply', () => {
  const unanswered = thread('unanswered', { lastCommentAt: '2026-01-01T09:00:00Z' });
  const answered = thread('answered', { awaitingReviewer: true, lastCommentAt: '2026-01-01T11:00:00Z' });
  const afterFix = prWorkFrom(snapshot(), [unanswered, answered], { ...fresh, lastFixAt: Date.parse('2026-01-01T10:00:00Z') });
  assert.deepEqual(afterFix.threads.map((t) => t.id), ['unanswered']);
  assert.equal(prWorkFingerprint(afterFix), prWorkFingerprint(prWorkFrom(snapshot(), [unanswered], fresh)), 'the same thread is not fixed twice');
});

test('counts a Bugbot review thread like any other unresolved thread', () => {
  const bugbot = thread('bug', { rootAuthor: 'cursor[bot]', comments: [{ author: 'cursor[bot]', body: 'Bug: null check missing' }] });
  assert.equal(hasPrWork(prWorkFrom(snapshot(), [bugbot], fresh)), true);
});

test('counts a review body submitted after the last fix, not one from before it', () => {
  const review = (submittedAt: string) => ({ author: 'carol', state: 'CHANGES_REQUESTED', body: 'Please split this function', submittedAt });
  const snap = snapshot({ reviews: [review('2026-01-01T09:00:00Z'), review('2026-01-01T15:00:00Z')] });
  const afterFix = prWorkFrom(snap, [], { ...fresh, lastFixAt: Date.parse('2026-01-01T12:00:00Z') });
  assert.deepEqual(afterFix.reviews.map((r) => r.submittedAt), ['2026-01-01T15:00:00Z']);
});

test('fingerprints the same PR state the same way, whatever the order', () => {
  const a = prWorkFrom(snapshot({ failingChecks: [{ name: 'lint', url: null }, { name: 'test', url: null }] }), [thread('x'), thread('y')], fresh);
  const b = prWorkFrom(snapshot({ failingChecks: [{ name: 'test', url: null }, { name: 'lint', url: null }] }), [thread('y'), thread('x')], fresh);
  assert.equal(prWorkFingerprint(a), prWorkFingerprint(b));
});

test('a new head commit or a new reply changes the fingerprint', () => {
  const base = prWorkFrom(snapshot(), [thread('x')], fresh);
  assert.notEqual(prWorkFingerprint(base), prWorkFingerprint(prWorkFrom(snapshot({ headRefOid: 'def' }), [thread('x')], fresh)));
  const replied = thread('x', { comments: [...thread('x').comments, { author: 'alice', body: 'still wrong' }] });
  assert.notEqual(prWorkFingerprint(base), prWorkFingerprint(prWorkFrom(snapshot(), [replied], fresh)));
});

test('describes what the sweep found in one phrase', () => {
  const work = prWorkFrom(snapshot({ mergeable: 'CONFLICTING', failingChecks: [{ name: 'lint', url: null }], comments: [comment('bob', '2026-01-01T10:00:00Z')] }), [], fresh);
  assert.equal(describePrWork(work), 'a merge conflict, 1 failing check and 1 unanswered comment');
  assert.equal(describePrWork(prWorkFrom(snapshot(), [thread('a'), thread('b')], fresh)), '2 unresolved review threads');
});

const review = (author: string, body = 'Looks mostly fine', state = 'COMMENTED') => ({ author, state, body, submittedAt: '2026-01-01T10:00:00Z' });

test('matches noise authors with or without the [bot] suffix, whatever the case', () => {
  assert.equal(isNoiseAuthor('github-actions', noiseCommentAuthors), true);
  assert.equal(isNoiseAuthor('github-actions[bot]', noiseCommentAuthors), true);
  assert.equal(isNoiseAuthor('Codecov[bot]', ['codecov']), true);
  assert.equal(isNoiseAuthor('bob', noiseCommentAuthors), false);
});

test('drops top-level comments from report bots and keeps human ones', () => {
  const snap = snapshot({ comments: [comment('github-actions', '2026-01-01T10:00:00Z'), comment('codecov[bot]', '2026-01-01T10:01:00Z'), comment('bob', '2026-01-01T10:02:00Z')] });
  const work = prWorkFrom(snap, [], fresh);
  assert.deepEqual(work.comments.map((c) => c.author), ['bob']);
  assert.equal(work.ignored.length, 2);
  assert.equal(hasPrWork(prWorkFrom(snapshot({ comments: [comment('github-actions[bot]', '2026-01-01T10:00:00Z')] }), [], fresh)), false);
});

test('drops the Bugbot summary body but keeps its inline threads', () => {
  const snap = snapshot({ reviews: [review('cursor', BUGBOT_SUMMARY), review('cursor[bot]', BUGBOT_SUMMARY)] });
  const bugbot = thread('bug', { rootAuthor: 'cursor', comments: [{ author: 'cursor', body: 'Bug: null check missing' }] });
  const work = prWorkFrom(snap, [bugbot], fresh);
  assert.deepEqual(work.reviews, []);
  assert.deepEqual(work.threads.map((t) => t.id), ['bug']);
  assert.equal(hasPrWork(work), true);
  assert.equal(hasPrWork(prWorkFrom(snap, [], fresh)), false);
});

test('keeps every other review body, including one from a Cursor automation', () => {
  const approvalAgent = review('cursor', '**Review needed, please check:**\n* Empty Lago `video` buckets must be dropped.');
  const work = prWorkFrom(snapshot({ reviews: [review('carol', 'Please split this', 'CHANGES_REQUESTED'), approvalAgent] }), [], fresh);
  assert.deepEqual(work.reviews.map((r) => r.author), ['carol', 'cursor']);
  assert.deepEqual(work.ignored, []);
});

test('ignored items never change the fingerprint or wake the sweep', () => {
  const quiet = prWorkFrom(snapshot(), [thread('x')], fresh);
  const noisy = prWorkFrom(
    snapshot({
      comments: [comment('github-actions', '2026-01-01T10:00:00Z')],
      reviews: [review('cursor', BUGBOT_SUMMARY)],
      supersededChecks: [{ name: 'plan', url: null }],
    }),
    [thread('x')],
    fresh,
  );
  assert.equal(prWorkFingerprint(noisy), prWorkFingerprint(quiet));
  const onlyNoise = prWorkFrom(snapshot({ comments: [comment('github-actions', '2026-01-01T10:00:00Z')], supersededChecks: [{ name: 'plan', url: null }] }), [], fresh);
  assert.equal(hasPrWork(onlyNoise), false);
});

test('lists every ignored item with its reason, or nothing when none was dropped', () => {
  const snap = snapshot({ comments: [comment('github-actions', '2026-01-01T10:00:00Z')], reviews: [review('cursor', BUGBOT_SUMMARY)], supersededChecks: [{ name: 'plan', url: null }] });
  const section = describeIgnored(prWorkFrom(snap, [], fresh));
  assert.match(section, /^## Ignored/);
  assert.match(section, /need no triage line/);
  assert.match(section, /cancelled job superseded/);
  assert.match(section, /report-bot comment/);
  assert.match(section, /Bugbot summary/);
  assert.equal(describeIgnored(prWorkFrom(snapshot(), [], fresh)), '');
});

test('a fix round that committed nothing does not re-review an approved head', () => {
  assert.equal(reviewAfterFix({ committed: false, lastVerdict: 'APPROVE' }), false);
  assert.equal(reviewAfterFix({ committed: true, lastVerdict: 'APPROVE' }), true);
  assert.equal(reviewAfterFix({ committed: false, lastVerdict: 'CHANGES' }), true);
  assert.equal(reviewAfterFix({ committed: false, lastVerdict: null }), true);
});

test('a slash command for a GitHub bot is not PR work, as a comment or as a review body', () => {
  const command = "/forced-any-approval It's safe if enterprise-billing approves these PRs.";
  const w = prWorkFrom(
    snapshot({
      comments: [{ author: 'owner', body: '/retest', createdAt: '2026-01-01T10:00:00Z', url: 'https://x/c1' }],
      reviews: [{ author: 'owner', state: 'COMMENTED', body: command, submittedAt: '2026-01-01T10:00:00Z' }],
    }),
    [],
    fresh,
  );
  assert.equal(hasPrWork(w), false);
  assert.deepEqual(w.ignored, ['PR comment by owner (https://x/c1): a command for a GitHub bot', 'PR review by owner (COMMENTED): a command for a GitHub bot']);
});

test('only a leading /word counts as a bot command', () => {
  assert.equal(isBotCommand('  /retest\n'), true);
  assert.equal(isBotCommand('/forced-any-approval reason'), true);
  assert.equal(isBotCommand('/path/to/file.py is wrong'), false);
  assert.equal(isBotCommand('Please /retest this'), false);
  assert.equal(isBotCommand('why is this /3 here?'), false);
});

const APPROVAL_AGENT = [
  '<!-- CURSOR_AUTOMATION_ID: a5022ae5 | RUN_ID: bc-6588 -->',
  '**Cannot approve:** needs review from @enterprise-billing.',
  '',
  '**Review needed, please check:**',
  '* Confirm `groupBy=user` with `filters=video:<id>` is the Lago query to ship',
  '',
  '<sub>Sent by Cursor Approval Agent: EnactServices PR Approver</sub>',
].join('\n');

test("the approval agent's call for a code owner is not PR work, as a review or as a comment", () => {
  const w = prWorkFrom(
    snapshot({
      comments: [{ author: 'cursor', body: APPROVAL_AGENT, createdAt: '2026-01-01T10:00:00Z', url: 'https://x/c1' }],
      reviews: [{ author: 'cursor', state: 'COMMENTED', body: APPROVAL_AGENT, submittedAt: '2026-01-01T10:00:00Z' }],
    }),
    [],
    fresh,
  );
  assert.equal(hasPrWork(w), false);
  assert.deepEqual(w.ignored, [
    'PR comment by cursor (https://x/c1): the approval agent asking a human code owner to review; it names no defect',
    'PR review by cursor (COMMENTED): the approval agent asking a human code owner to review; it names no defect',
  ]);
});

test("Bugbot's findings still reach the fixer next to an approval-agent review", () => {
  const w = prWorkFrom(
    snapshot({ reviews: [{ author: 'cursor', state: 'COMMENTED', body: APPROVAL_AGENT, submittedAt: '2026-01-01T10:00:00Z' }] }),
    [thread('t1', { rootAuthor: 'cursor', rootIsBot: true, comments: [{ author: 'cursor', body: 'Null check missing in parse_filter' }] })],
    fresh,
  );
  assert.equal(hasPrWork(w), true);
  assert.equal(w.threads.length, 1);
  assert.equal(w.reviews.length, 0);
});
