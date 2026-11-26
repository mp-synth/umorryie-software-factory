import { createHash } from 'node:crypto';
import type { PrSweepSkip } from '@factory/shared';
import type { HumanCheck, PrCheck, PrSnapshot, ReviewThread } from '../github.ts';
import { ACTIONABLE, type CheckVerdict } from './check-policy.ts';

export interface PrWork {
  snap: PrSnapshot;
  conflicting: boolean;
  ciStillRunning: boolean;
  failingChecks: PrSnapshot['failingChecks'];
  threads: ReviewThread[];
  comments: PrSnapshot['comments'];
  reviews: PrSnapshot['reviews'];
  ignored: string[];
  /** Failing checks only people, or work outside this repo, can turn green. */
  waitingOn: string[];
}

export type ClassifyCheck = (check: PrCheck) => CheckVerdict;

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
const everyCheckActs: ClassifyCheck = () => ({ class: 'fix', note: null, needsLog: false });

function splitByPolicy(checks: PrCheck[], classify: ClassifyCheck) {
  // A rule that depends on the job log decides only once the log is read; until then the check counts as work.
  const verdicts = checks.map((c) => ({ check: c, verdict: classify(c) })).map((v) => (v.verdict.needsLog ? { ...v, verdict: { ...v.verdict, class: 'fix' as const } } : v));
  const of = (...classes: CheckVerdict['class'][]) => verdicts.filter((v) => classes.includes(v.verdict.class));
  return {
    actionable: of(...ACTIONABLE).map((v) => v.check),
    waitingOn: of('people-only', 'waiting-on').map((v) => `${v.check.name}: ${v.verdict.note ?? (v.verdict.class === 'waiting-on' ? 'waits for work outside this repo' : 'only people turn it green')}`),
    ignored: of('ignore').map((v) => `Failing CI check ${v.check.name}: the check policy ignores it`),
  };
}

// Top-level comments and review bodies from bots name no work: a bot's finding that needs a change comes as a
// review thread. An approval needs no change either, whatever its text says.
function triageReason(item: { author: string; body: string; authorIsBot?: boolean }, noiseCommentAuthors: string[], state?: string): string | null {
  if (isNoiseAuthor(item.author, noiseCommentAuthors)) return 'report-bot comment';
  if (isApprovalRouting(item.body)) return 'the approval agent asking a human code owner to review; it names no defect';
  if (isBotCommand(item.body)) return 'a command for a GitHub bot';
  if (state && isFindingsSummary(item.body)) return 'Bugbot summary, each of its findings is an inline thread';
  if (state === 'APPROVED') return 'an approval; it asks for no change';
  if (item.authorIsBot) return "a bot's comment; a bot finding that needs a change comes as a review thread";
  return null;
}

export function prWorkFrom(
  snap: PrSnapshot,
  unresolved: ReviewThread[],
  opts: { lastFixAt: number | null; noiseCommentAuthors: string[]; classify?: ClassifyCheck },
): PrWork {
  const isNew = (iso: string) => time(iso) > (opts.lastFixAt ?? 0);
  const policy = splitByPolicy(snap.failingChecks, opts.classify ?? everyCheckActs);
  const ciStillRunning = policy.actionable.length > 0 && snap.pendingChecks.length > 0;
  const comments = snap.comments.filter((c) => isNew(c.createdAt)).map((c) => ({ item: c, why: triageReason(c, opts.noiseCommentAuthors) }));
  const reviews = snap.reviews
    .filter((r) => r.body.trim() && isNew(r.submittedAt))
    .map((r) => ({ item: r, why: triageReason(r, opts.noiseCommentAuthors, r.state) }));
  return {
    snap,
    conflicting: snap.mergeable === 'CONFLICTING',
    ciStillRunning,
    failingChecks: ciStillRunning ? [] : policy.actionable,
    threads: unresolved.filter((t) => !t.awaitingReviewer && (!t.outdated || isNew(t.lastCommentAt))),
    comments: comments.filter((c) => !c.why).map((c) => c.item),
    reviews: reviews.filter((r) => !r.why).map((r) => r.item),
    waitingOn: policy.waitingOn,
    ignored: [
      ...snap.supersededChecks.map((c) => `Failing CI check ${c.name}: a cancelled job superseded by a later run of the same workflow`),
      ...policy.ignored,
      ...comments.filter((c) => c.why).map((c) => `PR comment by ${c.item.author} (${c.item.url}): ${c.why}`),
      ...reviews.filter((r) => r.why).map((r) => `PR review by ${r.item.author} (${r.item.state}): ${r.why}`),
    ],
  };
}

/** The work left once failing checks that also fail where the PR's base is are set aside: they are not this PR's. */
export function withoutInherited(w: PrWork, inherited: string[]): PrWork {
  if (!inherited.length) return w;
  return {
    ...w,
    failingChecks: w.failingChecks.filter((c) => !inherited.includes(c.name)),
    ignored: [...w.ignored, ...inherited.map((name) => `Failing CI check ${name}: fails the same way where the PR's base is, so it is not this PR's`)],
  };
}

export function hasPrWork(w: PrWork): boolean {
  return w.conflicting || w.failingChecks.length > 0 || w.threads.length > 0 || w.comments.length > 0 || w.reviews.length > 0;
}

// What keeps the PR from merging after a fixer already had this exact state, or null when nothing does
// (threads and comments wait for people, not for another fixer). The arbiter decides even after the
// ticket used its rounds, so a red PR never waits for the owner; the arbiter's own limit of decisions in
// a row without progress bounds the retries.
export function unmergeableStop(w: PrWork, rounds: { round: number; maxRounds: number }): { why: string; askArbiter: boolean } | null {
  const parts = [
    w.conflicting ? 'it conflicts with its base' : '',
    w.failingChecks.length ? `CI fails (${w.failingChecks.map((c) => c.name).join(', ')})` : '',
  ].filter(Boolean);
  if (!parts.length) return null;
  const why = `${parts.join(' and ')} on ${w.snap.url}, and the PR is unchanged since a fixer had exactly this. It can't merge like this.`;
  if (rounds.round < rounds.maxRounds) return { why, askArbiter: true };
  return { why: `${why} ${rounds.round} rounds of fixes did not get it there, so the arbiter decides what happens next.`, askArbiter: true };
}

export function prWorkFingerprint(w: PrWork): string {
  const state = {
    head: w.snap.headRefOid,
    conflicting: w.conflicting,
    failing: w.failingChecks.map((c) => `${c.workflowName ?? ''}:${c.name}:${c.url ?? ''}`).sort(),
    threads: w.threads.map((t) => `${t.id}:${t.comments.map((c) => `${c.author}:${c.body}`).join('|')}`).sort(),
    comments: w.comments.map((c) => `${c.url}:${c.body}`).sort(),
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

/**
 * Why the sweep starts no fixer on an open PR, for the ticket to show: without it an adopted PR sits
 * at "built" with no runs and nothing says it only waits for people.
 */
export function sweepSkip(
  w: PrWork,
  opts: { alreadyHandled: boolean; humanChecks: HumanCheck[]; decided?: Pick<PrSweepSkip, 'reason' | 'why'> },
): Omit<PrSweepSkip, 'since'> {
  const human = opts.humanChecks.map((c) => `${c.name}: ${c.description || (c.state === 'pending' ? 'not approved yet' : 'failed')}`);
  const duplicatesHumanCheck = (line: string) => opts.humanChecks.some((check) => line.startsWith(`${check.name}:`));
  return {
    headSha: w.snap.headRefOid,
    ...(opts.decided ?? skipReason(w, opts.alreadyHandled)),
    waitingOn: [...human, ...w.waitingOn.filter((line) => !duplicatesHumanCheck(line))],
    ignored: w.ignored,
  };
}

function skipReason(w: PrWork, alreadyHandled: boolean): Pick<PrSweepSkip, 'reason' | 'why'> {
  if (alreadyHandled) {
    return {
      reason: 'already-tried',
      why: `A fixer already had ${describePrWork(w)} in this exact state; the sweep starts another once the PR changes, or Fix PRs now starts one at once.`,
    };
  }
  if (w.ciStillRunning) {
    return {
      reason: 'ci-running',
      why: `${count(w.snap.failingChecks.length, 'check')} failed while others still run; the sweep waits for CI to finish before fixing.`,
    };
  }
  if (w.snap.mergeable === 'UNKNOWN') {
    return { reason: 'merge-unknown', why: 'GitHub is still working out whether the PR merges cleanly; the sweep asks again shortly.' };
  }
  const tail = 'the PR merges cleanly and no review thread or comment needs an answer.';
  if (w.snap.pendingChecks.length) return { reason: 'ci-running', why: `Nothing for a fixer yet: CI is still running, ${tail}` };
  return { reason: 'idle', why: `Nothing for a fixer: ${w.snap.finishedChecks ? 'CI passes' : 'no CI check has reported'}, ${tail}` };
}

export function sameSweepSkip(a: Omit<PrSweepSkip, 'since'>, b: Omit<PrSweepSkip, 'since'>): boolean {
  const key = (s: Omit<PrSweepSkip, 'since'>) => JSON.stringify([s.headSha, s.reason, s.why, s.waitingOn, s.ignored]);
  return key(a) === key(b);
}
