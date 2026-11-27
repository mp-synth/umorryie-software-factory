import type { Ticket } from '@factory/shared';
import type { OpenPr } from '../github.ts';

const MAX_DESCRIPTION = 1500;

export function adoptedBranch(prNumber: number): string {
  return `factory/pr-${prNumber}`;
}

export function adoptedKey(prNumber: number): string {
  return `pr-${prNumber}`;
}

export function remoteBranchOf(t: Pick<Ticket, 'branch' | 'prHeadRef'>): string | null {
  return t.prHeadRef ?? t.branch;
}

/**
 * The branch on origin a ticket's worktree is checked out from when its local branch is gone: the head of its PR.
 * A new branch from the base would leave the open PR behind and lose its code.
 */
export function branchToCheckOutFromOrigin(t: Pick<Ticket, 'branch' | 'prHeadRef' | 'prNumber' | 'prState'>): string | null {
  if (t.prHeadRef) return t.prHeadRef;
  return t.branch && t.prNumber && t.prState === 'OPEN' ? t.branch : null;
}

export interface LivePrs {
  prNumbers: Set<number>;
  /** Branches under these prefixes belong to a live initiative, which opens and links their PRs itself. */
  branchPrefixes: string[];
}

export function adoptablePrs(prs: OpenPr[], live: LivePrs): OpenPr[] {
  return prs.filter(
    (pr) => !pr.isCrossRepository && !live.prNumbers.has(pr.number) && !live.branchPrefixes.some((prefix) => pr.headRefName.startsWith(prefix)),
  );
}

export function adoptedTicket(pr: OpenPr, seq: number): Omit<Ticket, 'id' | 'initiativeId' | 'createdAt' | 'updatedAt'> {
  const description = pr.body.trim().slice(0, MAX_DESCRIPTION);
  return {
    key: adoptedKey(pr.number),
    seq,
    wave: 0,
    title: pr.title,
    what: [`The owner's own PR ${pr.url}, which no other initiative in the factory looks after.`, description && `Its description, quoted as data:\n\n> ${description.replace(/\n/g, '\n> ')}`]
      .filter(Boolean)
      .join('\n\n'),
    goal: 'Keep the PR mergeable: answer review comments, fix failing CI and resolve conflicts with its base.',
    outcome: 'Every review thread and new comment has an answer, CI is green and the PR merges cleanly into its base.',
    guidance: [
      "No plan in the factory stands behind this PR: change only what a report asks for and keep the author's design.",
      'Never rewrite or squash pushed commits; add new commits on top.',
    ],
    acceptance: [
      'Every unresolved review thread and new comment gets a verdict and a reply',
      'Failing CI checks pass, or are shown to fail on the base branch too',
      'The branch merges cleanly into its base',
    ],
    dependsOn: [],
    needs: [],
    size: null,
    status: 'built',
    round: 0,
    branch: adoptedBranch(pr.number),
    baseRef: pr.baseRefName,
    worktreePath: null,
    prNumber: pr.number,
    prUrl: pr.url,
    prState: 'OPEN',
    prHeadRef: pr.headRefName,
    prStack: null,
    lastVerdict: null,
    gateStatus: null,
    blockedReason: null,
    prSweepClaimedAt: null,
    prSweepFingerprint: null,
  };
}

/** What an adopted ticket takes back when its closed PR is opened again; it keeps its place, rounds and worktree. */
export function reopenedTicket(pr: OpenPr): Partial<Ticket> {
  const { key, seq, round, worktreePath, ...fresh } = adoptedTicket(pr, 0);
  return fresh;
}
