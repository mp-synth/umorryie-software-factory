import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrSnapshot, ReviewThread } from '../github.ts';
import { describeIgnored, describePrWork, hasPrWork, isNoiseAuthor, prWorkFingerprint, prWorkFrom, reviewAfterFix } from './pr-work.ts';

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
  comments: [{ author: 'alice', body: 'rename this' }],
  ...patch,
});

const comment = (author: string, createdAt: string, url = `https://x/${author}/${createdAt}`) => ({ author, body: 'why?', createdAt, url });
const noiseCommentAuthors = ['github-actions', 'codecov'];
const me = { me: 'factory-owner', lastFixAt: null, noiseCommentAuthors };
const BUGBOT_SUMMARY = '<!-- BUGBOT_REVIEW -->\nCursor Bugbot has reviewed your changes and found 1 potential issue.';

test('a clean PR has nothing to act on', () => {
  assert.equal(hasPrWork(prWorkFrom(snapshot(), [], me)), false);
});

test('waits for CI to finish before acting on failing checks', () => {
  const failing = [{ name: 'lint', url: null }];
  assert.equal(hasPrWork(prWorkFrom(snapshot({ failingChecks: failing, pendingChecks: ['test'] }), [], me)), false);
  assert.equal(hasPrWork(prWorkFrom(snapshot({ failingChecks: failing }), [], me)), true);
});

test('skips threads that wait for their reviewer or are outdated', () => {
  const threads = [thread('a', { awaitingReviewer: true }), thread('b', { outdated: true }), thread('c')];
  assert.deepEqual(prWorkFrom(snapshot(), threads, me).threads.map((t) => t.id), ['c']);
});

test('only counts comments newer than the last fix and the owner’s last answer', () => {
  const snap = snapshot({
    comments: [comment('bob', '2026-01-01T10:00:00Z'), comment('factory-owner', '2026-01-01T11:00:00Z'), comment('bob', '2026-01-01T12:00:00Z')],
  });
  assert.deepEqual(prWorkFrom(snap, [], me).comments.map((c) => c.createdAt), ['2026-01-01T12:00:00Z']);
  assert.equal(prWorkFrom(snap, [], { ...me, lastFixAt: Date.parse('2026-01-01T13:00:00Z') }).comments.length, 0);
});

test('counts a Bugbot review thread like any other unresolved thread', () => {
  const bugbot = thread('bug', { rootAuthor: 'cursor[bot]', comments: [{ author: 'cursor[bot]', body: 'Bug: null check missing' }] });
  assert.equal(hasPrWork(prWorkFrom(snapshot(), [bugbot], me)), true);
});

test('counts a review body submitted after the last fix, not one from before it', () => {
  const review = (submittedAt: string) => ({ author: 'carol', state: 'CHANGES_REQUESTED', body: 'Please split this function', submittedAt });
  const snap = snapshot({ reviews: [review('2026-01-01T09:00:00Z'), review('2026-01-01T15:00:00Z')] });
  const afterFix = prWorkFrom(snap, [], { ...me, lastFixAt: Date.parse('2026-01-01T12:00:00Z') });
  assert.deepEqual(afterFix.reviews.map((r) => r.submittedAt), ['2026-01-01T15:00:00Z']);
});

test('fingerprints the same PR state the same way, whatever the order', () => {
  const a = prWorkFrom(snapshot({ failingChecks: [{ name: 'lint', url: null }, { name: 'test', url: null }] }), [thread('x'), thread('y')], me);
  const b = prWorkFrom(snapshot({ failingChecks: [{ name: 'test', url: null }, { name: 'lint', url: null }] }), [thread('y'), thread('x')], me);
  assert.equal(prWorkFingerprint(a), prWorkFingerprint(b));
});

test('a new head commit or a new reply changes the fingerprint', () => {
  const base = prWorkFrom(snapshot(), [thread('x')], me);
  assert.notEqual(prWorkFingerprint(base), prWorkFingerprint(prWorkFrom(snapshot({ headRefOid: 'def' }), [thread('x')], me)));
  const replied = thread('x', { comments: [...thread('x').comments, { author: 'alice', body: 'still wrong' }] });
  assert.notEqual(prWorkFingerprint(base), prWorkFingerprint(prWorkFrom(snapshot(), [replied], me)));
});

test('describes what the sweep found in one phrase', () => {
  const work = prWorkFrom(snapshot({ mergeable: 'CONFLICTING', failingChecks: [{ name: 'lint', url: null }], comments: [comment('bob', '2026-01-01T10:00:00Z')] }), [], me);
  assert.equal(describePrWork(work), 'a merge conflict, 1 failing check and 1 unanswered comment');
  assert.equal(describePrWork(prWorkFrom(snapshot(), [thread('a'), thread('b')], me)), '2 unresolved review threads');
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
  const work = prWorkFrom(snap, [], me);
  assert.deepEqual(work.comments.map((c) => c.author), ['bob']);
  assert.equal(work.ignored.length, 2);
  assert.equal(hasPrWork(prWorkFrom(snapshot({ comments: [comment('github-actions[bot]', '2026-01-01T10:00:00Z')] }), [], me)), false);
});

test('drops the Bugbot summary body but keeps its inline threads', () => {
  const snap = snapshot({ reviews: [review('cursor', BUGBOT_SUMMARY), review('cursor[bot]', BUGBOT_SUMMARY)] });
  const bugbot = thread('bug', { rootAuthor: 'cursor', comments: [{ author: 'cursor', body: 'Bug: null check missing' }] });
  const work = prWorkFrom(snap, [bugbot], me);
  assert.deepEqual(work.reviews, []);
  assert.deepEqual(work.threads.map((t) => t.id), ['bug']);
  assert.equal(hasPrWork(work), true);
  assert.equal(hasPrWork(prWorkFrom(snap, [], me)), false);
});

test('keeps every other review body, including one from a Cursor automation', () => {
  const approvalAgent = review('cursor', '**Review needed, please check:**\n* Empty Lago `video` buckets must be dropped.');
  const work = prWorkFrom(snapshot({ reviews: [review('carol', 'Please split this', 'CHANGES_REQUESTED'), approvalAgent] }), [], me);
  assert.deepEqual(work.reviews.map((r) => r.author), ['carol', 'cursor']);
  assert.deepEqual(work.ignored, []);
});

test('ignored items never change the fingerprint or wake the sweep', () => {
  const quiet = prWorkFrom(snapshot(), [thread('x')], me);
  const noisy = prWorkFrom(
    snapshot({
      comments: [comment('github-actions', '2026-01-01T10:00:00Z')],
      reviews: [review('cursor', BUGBOT_SUMMARY)],
      supersededChecks: [{ name: 'plan', url: null }],
    }),
    [thread('x')],
    me,
  );
  assert.equal(prWorkFingerprint(noisy), prWorkFingerprint(quiet));
  const onlyNoise = prWorkFrom(snapshot({ comments: [comment('github-actions', '2026-01-01T10:00:00Z')], supersededChecks: [{ name: 'plan', url: null }] }), [], me);
  assert.equal(hasPrWork(onlyNoise), false);
});

test('lists every ignored item with its reason, or nothing when none was dropped', () => {
  const snap = snapshot({ comments: [comment('github-actions', '2026-01-01T10:00:00Z')], reviews: [review('cursor', BUGBOT_SUMMARY)], supersededChecks: [{ name: 'plan', url: null }] });
  const section = describeIgnored(prWorkFrom(snap, [], me));
  assert.match(section, /^## Ignored/);
  assert.match(section, /need no triage line/);
  assert.match(section, /cancelled job superseded/);
  assert.match(section, /report-bot comment/);
  assert.match(section, /Bugbot summary/);
  assert.equal(describeIgnored(prWorkFrom(snapshot(), [], me)), '');
});

test('a fix round that committed nothing does not re-review an approved head', () => {
  assert.equal(reviewAfterFix({ committed: false, lastVerdict: 'APPROVE' }), false);
  assert.equal(reviewAfterFix({ committed: true, lastVerdict: 'APPROVE' }), true);
  assert.equal(reviewAfterFix({ committed: false, lastVerdict: 'CHANGES' }), true);
  assert.equal(reviewAfterFix({ committed: false, lastVerdict: null }), true);
});
