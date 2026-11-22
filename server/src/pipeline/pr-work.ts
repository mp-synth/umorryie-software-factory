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
}

const time = (iso: string) => new Date(iso).getTime();

export function prWorkFrom(snap: PrSnapshot, unresolved: ReviewThread[], opts: { me: string | null; lastFixAt: number | null }): PrWork {
  const lastOwnComment = Math.max(0, ...snap.comments.filter((c) => c.author === opts.me).map((c) => time(c.createdAt)));
  const answeredUntil = Math.max(opts.lastFixAt ?? 0, lastOwnComment);
  const ciStillRunning = snap.failingChecks.length > 0 && snap.pendingChecks.length > 0;
  return {
    snap,
    conflicting: snap.mergeable === 'CONFLICTING',
    ciStillRunning,
    failingChecks: ciStillRunning ? [] : snap.failingChecks,
    threads: unresolved.filter((t) => !t.outdated && !t.awaitingReviewer),
    comments: snap.comments.filter((c) => c.author !== opts.me && time(c.createdAt) > answeredUntil),
    reviews: snap.reviews.filter((r) => r.body.trim() && r.author !== opts.me && time(r.submittedAt) > answeredUntil),
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
