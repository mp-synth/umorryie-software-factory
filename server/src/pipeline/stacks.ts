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

export function syncTarget<T extends StackMember & StackFields>(ticket: T, all: T[], baseBranch: string): { parent: T | null; target: string } | null {
  const parent = stackBase(ticket, all);
  if (parent) return isOpenPr(parent) ? { parent, target: remoteBranchOf(parent)! } : null;
  return ticket.baseRef === baseBranch ? null : { parent: null, target: baseBranch };
}

export type StackStep =
  | { kind: 'create'; prs: number[] }
  | { kind: 'add'; stack: number; prs: number[] }
  | { kind: 'done'; stack: number }
  | { kind: 'taken'; parent: number; top: number };

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

export function nextStackStep(chain: number[], found: { pr: number; stack: PrStack } | null): StackStep {
  if (!found) return { kind: 'create', prs: chain };
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
    case 'taken':
      return `#${chain[chain.length - 1]} targets the branch of #${step.parent} but can't join its GitHub stack: #${step.top} already sits on top of it, and a stack is a single line of PRs.`;
    case 'done':
      return null;
  }
}
