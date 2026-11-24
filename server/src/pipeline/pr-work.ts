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

// Cursor's approval agent decides who must review a PR ("Cannot approve: needs review from
// @team") and lists points for that human to check. It names no defect, so a fixer can only
// answer "nothing to change": on 2026-11-23 five fixers and five verifiers did exactly that.
const APPROVAL_ROUTING_MARKERS = ['Sent by Cursor Approval Agent'];

export function isApprovalRouting(body: string): boolean {
  return APPROVAL_ROUTING_MARKERS.some((marker) => body.includes(marker));
}

// A comment or review that starts with `/command` (`/forced-any-approval …`, `/retest`) talks to a
// GitHub bot, not to the code's author; a fixer can only answer "nothing to change". `/path/to/file`
// is not a command.
const BOT_COMMAND = /^\/[a-z][\w-]*(\s|$)/i;

export function isBotCommand(body: string): boolean {
  return BOT_COMMAND.test(body.trim());
}

// The factory posts as the owner's GitHub login, so authorship can't tell its comments apart: the
// marker can, and the snapshot already drops marked comments. Everything else counts, whoever wrote
// it, unless the last fix already saw it. A thread the factory has not answered counts even then:
// a fix can succeed without a reply (verifier blocked, arbiter escalated), and the fingerprint
// already keeps the same thread from being fixed twice. Only an outdated one needs a newer reply.
export function prWorkFrom(snap: PrSnapshot, unresolved: ReviewThread[], opts: { lastFixAt: number | null; noiseCommentAuthors: string[] }): PrWork {
  const isNew = (iso: string) => time(iso) > (opts.lastFixAt ?? 0);
  const ciStillRunning = snap.failingChecks.length > 0 && snap.pendingChecks.length > 0;
  const newComments = snap.comments.filter((c) => isNew(c.createdAt));
  const newReviews = snap.reviews.filter((r) => r.body.trim() && isNew(r.submittedAt));
  const noiseComments = newComments.filter((c) => isNoiseAuthor(c.author, opts.noiseCommentAuthors));
  const routingComments = newComments.filter((c) => !noiseComments.includes(c) && isApprovalRouting(c.body));
  const commandComments = newComments.filter((c) => !noiseComments.includes(c) && !routingComments.includes(c) && isBotCommand(c.body));
  const noiseReviews = newReviews.filter((r) => isFindingsSummary(r.body));
  const routingReviews = newReviews.filter((r) => !noiseReviews.includes(r) && isApprovalRouting(r.body));
  const commandReviews = newReviews.filter((r) => !noiseReviews.includes(r) && !routingReviews.includes(r) && isBotCommand(r.body));
  const dropped = new Set<unknown>([...noiseComments, ...routingComments, ...commandComments, ...noiseReviews, ...routingReviews, ...commandReviews]);
  return {
    snap,
    conflicting: snap.mergeable === 'CONFLICTING',
    ciStillRunning,
    failingChecks: ciStillRunning ? [] : snap.failingChecks,
    threads: unresolved.filter((t) => !t.awaitingReviewer && (!t.outdated || isNew(t.lastCommentAt))),
    comments: newComments.filter((c) => !dropped.has(c)),
    reviews: newReviews.filter((r) => !dropped.has(r)),
    ignored: [
      ...snap.supersededChecks.map((c) => `Failing CI check ${c.name}: a cancelled job superseded by a later run of the same workflow`),
      ...noiseComments.map((c) => `PR comment by ${c.author} (${c.url}): report-bot comment`),
      ...routingComments.map((c) => `PR comment by ${c.author} (${c.url}): the approval agent asking a human code owner to review; it names no defect`),
      ...commandComments.map((c) => `PR comment by ${c.author} (${c.url}): a command for a GitHub bot`),
      ...noiseReviews.map((r) => `PR review by ${r.author} (${r.state}): Bugbot summary, each of its findings is an inline thread`),
      ...routingReviews.map((r) => `PR review by ${r.author} (${r.state}): the approval agent asking a human code owner to review; it names no defect`),
      ...commandReviews.map((r) => `PR review by ${r.author} (${r.state}): a command for a GitHub bot`),
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
