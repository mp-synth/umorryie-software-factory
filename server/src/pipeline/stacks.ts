import type { Ticket, TicketStatus } from '@factory/shared';
import type { PrStack } from '../github.ts';
import { remoteBranchOf } from './adopted-prs.ts';

type StackMember = Pick<Ticket, 'key' | 'dependsOn' | 'status'>;
type StackFields = Pick<Ticket, 'branch' | 'prHeadRef' | 'baseRef' | 'prNumber' | 'prState'>;

const LEFT_THE_STACK: TicketStatus[] = ['merged', 'canceled'];
const isOpenPr = (t: StackFields) => !!t.prNumber && t.prState === 'OPEN';

export function stackBase<T extends StackMember>(ticket: T, all: T[]): T | null {
  const seen = new Set<string>();
  for (let current = ticket; ; ) {
    seen.add(current.key);
    const parent = all.find((t) => t.key === current.dependsOn[0]);
    if (!parent || seen.has(parent.key)) return null;
    if (!LEFT_THE_STACK.includes(parent.status)) return parent;
    current = parent;
  }
}

export function getStackDepth<T extends StackMember>(ticket: T, all: T[]): number {
  let depth = 0;
  for (let below = stackBase(ticket, all); below && depth < all.length; below = stackBase(below, all)) depth++;
  return depth;
}

export function sortBottomUp<T extends StackMember>(tickets: T[], all: T[]): T[] {
  return [...tickets].sort((a, b) => getStackDepth(a, all) - getStackDepth(b, all));
}

// Feedback on a stacked ticket waits while a ticket below it still has feedback to fix or is being fixed:
// its fix reaches this branch through the stack sync, and only then does this ticket's fixer see it.
export function findFeedbackBlocker<T extends StackMember & { id: string }>(ticket: T, all: T[], withPendingFeedback: ReadonlySet<string>): T | null {
  let steps = 0;
  for (let below = stackBase(ticket, all); below && steps < all.length; below = stackBase(below, all), steps++) {
    if (below.status === 'fixing' || withPendingFeedback.has(below.id)) return below;
  }
  return null;
}

export function syncTarget<T extends StackMember & StackFields>(ticket: T, all: T[], baseBranch: string): { parent: T | null; target: string } | null {
  const parent = stackBase(ticket, all);
  if (parent) return isOpenPr(parent) ? { parent, target: remoteBranchOf(parent)! } : null;
  return ticket.baseRef === baseBranch ? null : { parent: null, target: baseBranch };
}

export type StackStep =
  | { kind: 'create'; prs: number[] }
  | { kind: 'add'; stack: number; prs: number[] }
  | { kind: 'done'; stack: number }
  | { kind: 'taken'; parent: number; top: number }
  | { kind: 'restack'; stack: number; prs: number[]; closed: number[] };

export function stackChain<T extends StackFields>(ticket: T, all: T[]): number[] | null {
  if (!isOpenPr(ticket)) return null;
  const chain = [ticket.prNumber!];
  let current = ticket;
  for (;;) {
    const parent = all.find((t) => remoteBranchOf(t) === current.baseRef && isOpenPr(t));
    if (!parent || chain.includes(parent.prNumber!)) break;
    chain.unshift(parent.prNumber!);
    current = parent;
  }
  return chain.length > 1 ? chain : null;
}

// GitHub keeps a PR closed without merging in its stack, and nothing can be stacked above it. When
// the stack's other PRs are the start of this chain and none has merged (merged PRs can't leave a
// stack), the stack is dissolved and made again from the chain.
function restackable(chain: number[], stack: PrStack): boolean {
  const closed = stack.closed ?? [];
  if (!closed.length || (stack.merged ?? []).length) return false;
  const open = stack.pullRequests.filter((n) => !closed.includes(n));
  return open.length > 0 && open.every((n, i) => chain[i] === n);
}

export function nextStackStep(chain: number[], found: { pr: number; stack: PrStack } | null): StackStep {
  if (!found) return { kind: 'create', prs: chain };
  if (restackable(chain, found.stack)) return { kind: 'restack', stack: found.stack.number, prs: chain, closed: found.stack.closed! };
  const top = found.stack.pullRequests[found.stack.pullRequests.length - 1];
  const at = chain.indexOf(found.pr);
  if (at === chain.length - 1) return { kind: 'done', stack: found.stack.number };
  if (top !== found.pr) return { kind: 'taken', parent: found.pr, top };
  return { kind: 'add', stack: found.stack.number, prs: chain.slice(at + 1) };
}

const refs = (prs: number[]) => prs.map((n) => `#${n}`).join(' → ');

export function stackStepMessage(step: StackStep, chain: number[]): string | null {
  switch (step.kind) {
    case 'create':
      return `Linked ${refs(step.prs)} as a stacked PR on GitHub.`;
    case 'add':
      return `Added ${refs(step.prs)} to the GitHub stack, on top of #${chain[chain.length - step.prs.length - 1]}.`;
    case 'taken': {
      const pr = chain[chain.length - 1];
      const below = chain[chain.length - 2];
      if (below !== step.parent) return `#${pr} builds on #${below}, which is outside the GitHub stack of #${step.parent}, so #${pr} stays outside it too; it still syncs and retargets like a stacked PR.`;
      return `#${pr} builds on #${step.parent} beside #${step.top}, which already sits on top of it in its GitHub stack. A GitHub stack is a single line of PRs, so #${pr} stays a PR on the branch of #${step.parent}, outside the stack; it still syncs and retargets like a stacked PR.`;
    }
    case 'restack':
      return `Made the GitHub stack again as ${refs(step.prs)}: closed ${refs(step.closed)} ${step.closed.length === 1 ? 'was' : 'were'} still in it, so nothing could stack above ${step.closed.length === 1 ? 'it' : 'them'}.`;
    case 'done':
      return null;
  }
}
