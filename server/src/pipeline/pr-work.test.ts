import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrSnapshot, ReviewThread } from '../github.ts';
import { type ClassifyCheck, describeIgnored, describePrWork, hasPrWork, isBotCommand, isNoiseAuthor, prWorkFingerprint, prWorkFrom, reviewAfterFix, sameSweepSkip, sweepSkip, unmergeableStop } from './pr-work.ts';

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
  hungJobs: [],
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

test('a PR a fixer could not turn green or mergeable is described by what blocks the merge', () => {
  const rounds = { round: 2, maxRounds: 5 };
  const red = prWorkFrom(snapshot({ mergeable: 'CONFLICTING', failingChecks: [{ name: 'test-unit', url: null }, { name: 'OpenAPI Contracts', url: null }] }), [], fresh);
  const stop = unmergeableStop(red, rounds)!;
  assert.match(stop.why, /^it conflicts with its base and CI fails \(test-unit, OpenAPI Contracts\) on https:\/\/github.com\/o\/r\/pull\/7,/);
  assert.equal(stop.askArbiter, true);
  assert.equal(unmergeableStop(prWorkFrom(snapshot(), [thread('a')], fresh), rounds), null);
  assert.equal(unmergeableStop(prWorkFrom(snapshot({ failingChecks: [{ name: 'lint', url: null }], pendingChecks: ['test'] }), [], fresh), rounds), null);
});

test('a PR still red after the ticket used its rounds goes to the arbiter, not the owner', () => {
  const red = prWorkFrom(snapshot({ failingChecks: [{ name: 'test-unit', url: null }] }), [], fresh);
  const stop = unmergeableStop(red, { round: 5, maxRounds: 5 })!;
  assert.equal(stop.askArbiter, true);
  assert.match(stop.why, /5 rounds of fixes did not get it there, so the arbiter decides what happens next\.$/);
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

const noHumans = { alreadyHandled: false, humanChecks: [] };

test('says why the sweep left a clean PR alone and what only people can move', () => {
  const approvalAgent = { ...comment('cursor', '2026-01-01T10:00:00Z'), body: 'Review needed.\n<sub>Sent by Cursor Approval Agent: PR Approver</sub>' };
  const work = prWorkFrom(snapshot({ finishedChecks: 4, comments: [approvalAgent] }), [], fresh);
  const skip = sweepSkip(work, {
    alreadyHandled: false,
    humanChecks: [
      { name: 'Code review', state: 'pending', description: 'needs review from @growth', url: null },
      { name: 'Meticulous Tests', state: 'failing', description: '', url: null },
    ],
  });
  assert.equal(skip.reason, 'idle');
  assert.equal(skip.headSha, 'abc');
  assert.match(skip.why, /^Nothing for a fixer: CI passes, the PR merges cleanly/);
  assert.deepEqual(skip.waitingOn, ['Code review: needs review from @growth', 'Meticulous Tests: failed']);
  assert.equal(skip.ignored.length, 1);
  assert.match(skip.ignored[0], /approval agent/);
});

test('deduplicates a people-only check whose name contains a colon', () => {
  const work = { ...prWorkFrom(snapshot({ finishedChecks: 1 }), [], fresh), waitingOn: ['CI: review: only people turn it green'] };
  const skip = sweepSkip(work, {
    alreadyHandled: false,
    humanChecks: [{ name: 'CI: review', state: 'pending', description: 'needs review from @growth', url: null }],
  });
  assert.deepEqual(skip.waitingOn, ['CI: review: needs review from @growth']);
});

test('tells CI still running, unknown mergeability and an already-tried state apart', () => {
  const failing = [{ name: 'lint', url: null }];
  assert.equal(sweepSkip(prWorkFrom(snapshot({ pendingChecks: ['test'] }), [], fresh), noHumans).reason, 'ci-running');
  const waitingForCi = sweepSkip(prWorkFrom(snapshot({ failingChecks: failing, pendingChecks: ['test'] }), [], fresh), noHumans);
  assert.equal(waitingForCi.reason, 'ci-running');
  assert.match(waitingForCi.why, /^1 check failed while others still run/);
  assert.equal(sweepSkip(prWorkFrom(snapshot({ mergeable: 'UNKNOWN' }), [], fresh), noHumans).reason, 'merge-unknown');
  const tried = sweepSkip(prWorkFrom(snapshot({ failingChecks: failing }), [], fresh), { ...noHumans, alreadyHandled: true });
  assert.equal(tried.reason, 'already-tried');
  assert.match(tried.why, /^A fixer already had 1 failing check in this exact state/);
});

test('treats a skip as unchanged until the PR or its reasons change', () => {
  const a = sweepSkip(prWorkFrom(snapshot({ finishedChecks: 1 }), [], fresh), noHumans);
  assert.equal(sameSweepSkip(a, { ...a }), true);
  assert.equal(sameSweepSkip(a, { ...a, headSha: 'def' }), false);
  assert.equal(sameSweepSkip(a, { ...a, waitingOn: ['Code review: needs review from @growth'] }), false);
});

test('a bot’s top-level comment or review body and any approval name no work', () => {
  const snap = snapshot({
    comments: [{ author: 'appsec-bot', body: 'Scan finished.', createdAt: '2026-01-01T10:00:00Z', url: 'https://x/1', authorIsBot: true }],
    reviews: [
      { author: 'alice', state: 'APPROVED', body: 'Looks good to me', submittedAt: '2026-01-01T10:00:00Z' },
      { author: 'cursor', state: 'COMMENTED', body: 'Two notes', submittedAt: '2026-01-01T10:00:00Z', authorIsBot: true },
      { author: 'bob', state: 'COMMENTED', body: 'Why this name?', submittedAt: '2026-01-01T10:00:00Z' },
    ],
  });
  const work = prWorkFrom(snap, [], fresh);
  assert.equal(work.comments.length, 0);
  assert.deepEqual(work.reviews.map((r) => r.author), ['bob']);
  assert.equal(work.ignored.length, 3);
});

test('the check policy keeps ignored and people-only checks away from a fixer', () => {
  const snap = snapshot({ failingChecks: [{ name: 'lint', url: null }, { name: 'Cursor Bugbot', url: null }, { name: 'OpenAPI breaking changes', url: null }] });
  const classify = (c: { name: string }) =>
    c.name === 'lint' ? { class: 'must-fix' as const, note: null, needsLog: false } : c.name === 'Cursor Bugbot' ? { class: 'ignore' as const, note: null, needsLog: false } : { class: 'people-only' as const, note: 'a breaking-change approval', needsLog: false };
  const work = prWorkFrom(snap, [], { ...fresh, classify });
  assert.deepEqual(work.failingChecks.map((c) => c.name), ['lint']);
  assert.deepEqual(work.waitingOn, ['OpenAPI breaking changes: a breaking-change approval']);
  assert.ok(work.ignored.some((line) => line.includes('Cursor Bugbot')));
});

test('a check whose policy rule depends on its log counts as work until the log is read', () => {
  const snap = snapshot({ failingChecks: [{ name: 'tests', url: null }] });
  const classify: ClassifyCheck = () => ({ class: 'ignore', note: null, needsLog: true });
  const work = prWorkFrom(snap, [], { lastFixAt: null, noiseCommentAuthors: [], classify });
  assert.deepEqual(work.failingChecks.map((c) => c.name), ['tests']);
  assert.deepEqual(work.ignored, []);
});
