import type { Ticket } from '@factory/shared';

export const MAX_BUILDS = 3;

export function buildNumber(wanted: string, branch: string): number {
  const suffix = branch.startsWith(`${wanted}-v`) ? branch.slice(wanted.length + 2) : '';
  return /^\d+$/.test(suffix) ? Number(suffix) : 1;
}

export function earlierBranches(wanted: string, branch: string): string[] {
  return Array.from({ length: buildNumber(wanted, branch) - 1 }, (_, i) => (i === 0 ? wanted : `${wanted}-v${i + 1}`));
}

type Dependent = Pick<Ticket, 'key' | 'dependsOn' | 'branch' | 'status'>;

const APPROVED: Ticket['status'][] = ['approved', 'merged'];

/**
 * Tickets stacked on this one, directly or higher up, that have a branch: they started from its
 * code. When it is rebuilt, the ones not approved yet are reset too and start again from its new
 * branch; an approved one stops the rebuild (see `rebuildBlocker`). Highest first.
 */
export function startedAbove<T extends Dependent>(key: string, all: T[]): T[] {
  const above: T[] = [];
  const visit = (k: string) => {
    for (const t of all) {
      if (!t.dependsOn.includes(k) || above.includes(t)) continue;
      above.push(t);
      visit(t.key);
    }
  };
  visit(key);
  return above.filter((t) => t.branch && t.status !== 'canceled').reverse();
}

// `builds` counts every build of the ticket: a rebuilt ticket keeps its branch (and PR), so the branch
// name alone no longer tells how often it was built.
export function rebuildBlocker(ticket: Pick<Ticket, 'key' | 'branch'> & { prHeadRef?: string | null }, wanted: string, all: Dependent[], builds = 1): string | null {
  if (ticket.prHeadRef) return 'It is your own PR, so the factory never rebuilds it: rewriting its history is your call.';
  const approved = startedAbove(ticket.key, all).filter((t) => APPROVED.includes(t.status));
  if (approved.length) return `It is not rebuilt automatically because ${approved.map((t) => t.key).join(', ')} already build on its branch and ${approved.length === 1 ? 'was' : 'were'} approved.`;
  if (Math.max(buildNumber(wanted, ticket.branch ?? wanted), builds) >= MAX_BUILDS) return `It is not rebuilt automatically because it was already built ${MAX_BUILDS} times.`;
  return null;
}
