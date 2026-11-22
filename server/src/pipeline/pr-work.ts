import { createHash } from 'node:crypto';
import type { PrSnapshot, ReviewThread } from '../github.ts';

export interface PrWork {
  snap: PrSnapshot;
  conflicting: boolean;
  ciStillRunning: boolean;
  failingChecks: PrSnapshot['failingChecks'];
  threads: ReviewThread[];
  comments: PrSnapshot['comments'];
  reviews: PrSnapshot['reviews'];
  ignored: string[];
}

const time = (iso: string) => new Date(iso).getTime();

const loginKey = (login: string) => login.replace(/\[bot\]$/i, '').toLowerCase();

export function isNoiseAuthor(login: string, authors: string[]): boolean {
  return authors.some((a) => loginKey(a) === loginKey(login));
}

// Bugbot posts every finding as its own inline thread; its review body only counts them.
const FINDINGS_SUMMARY_MARKERS = ['<!-- BUGBOT_REVIEW -->'];

export function isFindingsSummary(body: string): boolean {
  return FINDINGS_SUMMARY_MARKERS.some((marker) => body.includes(marker));
}

export function prWorkFrom(snap: PrSnapshot, unresolved: ReviewThread[], opts: { me: string | null; lastFixAt: number | null; noiseCommentAuthors: string[] }): PrWork {
  const lastOwnComment = Math.max(0, ...snap.comments.filter((c) => c.author === opts.me).map((c) => time(c.createdAt)));
  const answeredUntil = Math.max(opts.lastFixAt ?? 0, lastOwnComment);
  const ciStillRunning = snap.failingChecks.length > 0 && snap.pendingChecks.length > 0;
  const newComments = snap.comments.filter((c) => c.author !== opts.me && time(c.createdAt) > answeredUntil);
  const newReviews = snap.reviews.filter((r) => r.body.trim() && r.author !== opts.me && time(r.submittedAt) > answeredUntil);
  const noiseComments = newComments.filter((c) => isNoiseAuthor(c.author, opts.noiseCommentAuthors));
  const noiseReviews = newReviews.filter((r) => isFindingsSummary(r.body));
  return {
    snap,
    conflicting: snap.mergeable === 'CONFLICTING',
    ciStillRunning,
    failingChecks: ciStillRunning ? [] : snap.failingChecks,
    threads: unresolved.filter((t) => !t.outdated && !t.awaitingReviewer),
    comments: newComments.filter((c) => !noiseComments.includes(c)),
    reviews: newReviews.filter((r) => !noiseReviews.includes(r)),
    ignored: [
      ...snap.supersededChecks.map((c) => `Failing CI check ${c.name}: a cancelled job superseded by a later run of the same workflow`),
      ...noiseComments.map((c) => `PR comment by ${c.author} (${c.url}): report-bot comment`),
      ...noiseReviews.map((r) => `PR review by ${r.author} (${r.state}): Bugbot summary, each of its findings is an inline thread`),
    ],
  };
}

export function hasPrWork(w: PrWork): boolean {
  return w.conflicting || w.failingChecks.length > 0 || w.threads.length > 0 || w.comments.length > 0 || w.reviews.length > 0;
}

export function prWorkFingerprint(w: PrWork): string {
  const state = {
    head: w.snap.headRefOid,
    conflicting: w.conflicting,
    failing: w.failingChecks.map((c) => c.name).sort(),
    threads: w.threads.map((t) => `${t.id}:${t.comments.length}`).sort(),
    comments: w.comments.map((c) => c.url).sort(),
    reviews: w.reviews.map((r) => `${r.author}:${r.state}:${r.body}`).sort(),
  };
  return createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 16);
}

export function describeIgnored(w: PrWork): string {
  if (!w.ignored.length) return '';
  return `## Ignored\nThe factory dropped these before you started. They need no triage line and no reply.\n${w.ignored.map((line) => `- ${line}`).join('\n')}`;
}

export function reviewAfterFix(opts: { committed: boolean; lastVerdict: string | null }): boolean {
  return opts.committed || opts.lastVerdict !== 'APPROVE';
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function describePrWork(w: PrWork): string {
  const answers = w.comments.length + w.reviews.length;
  const parts = [
    w.conflicting ? 'a merge conflict' : '',
    w.failingChecks.length ? count(w.failingChecks.length, 'failing check') : '',
    w.threads.length ? count(w.threads.length, 'unresolved review thread') : '',
    answers ? count(answers, 'unanswered comment') : '',
  ].filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? 'nothing to act on';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
