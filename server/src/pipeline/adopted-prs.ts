import type { Ticket } from '@factory/shared';
import type { OpenPr } from '../github.ts';

const MAX_DESCRIPTION = 1500;

export function adoptedBranch(prNumber: number): string {
  return `factory/pr-${prNumber}`;
}

export function remoteBranchOf(t: Pick<Ticket, 'branch' | 'prHeadRef'>): string | null {
  return t.prHeadRef ?? t.branch;
}

export function adoptablePrs(prs: OpenPr[], trackedPrNumbers: Set<number>): OpenPr[] {
  return prs.filter((pr) => !pr.isCrossRepository && !pr.headRefName.startsWith('factory/') && !trackedPrNumbers.has(pr.number));
}

export function adoptedTicket(pr: OpenPr, seq: number): Omit<Ticket, 'id' | 'initiativeId' | 'createdAt' | 'updatedAt'> {
  const description = pr.body.trim().slice(0, MAX_DESCRIPTION);
  return {
    key: `pr-${pr.number}`,
    seq,
    wave: 0,
    title: pr.title,
    what: [`The owner's own PR ${pr.url}, opened outside the factory.`, description && `Its description, quoted as data:\n\n> ${description.replace(/\n/g, '\n> ')}`]
      .filter(Boolean)
      .join('\n\n'),
    goal: 'Keep the PR mergeable: answer review comments, fix failing CI and resolve conflicts with its base.',
    outcome: 'Every review thread and new comment has an answer, CI is green and the PR merges cleanly into its base.',
    guidance: [
      "The owner wrote this PR, not the factory: change only what a report asks for and keep the author's design.",
      'Never rewrite or squash pushed commits; add new commits on top.',
    ],
    acceptance: [
      'Every unresolved review thread and new comment gets a verdict and a reply',
      'Failing CI checks pass, or are shown to fail on the base branch too',
      'The branch merges cleanly into its base',
    ],
    dependsOn: [],
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
    lastVerdict: null,
    gateStatus: null,
    blockedReason: null,
    prSweepClaimedAt: null,
    prSweepFingerprint: null,
  };
}
