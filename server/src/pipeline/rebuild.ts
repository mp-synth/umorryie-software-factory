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

export function rebuildBlocker(ticket: Pick<Ticket, 'key' | 'branch'>, wanted: string, all: Dependent[]): string | null {
  const started = all.filter((t) => t.dependsOn.includes(ticket.key) && t.branch && t.status !== 'canceled');
  if (started.length) return `It is not rebuilt automatically because ${started.map((t) => t.key).join(', ')} already build on its branch.`;
  if (buildNumber(wanted, ticket.branch ?? wanted) >= MAX_BUILDS) return `It is not rebuilt automatically because it was already built ${MAX_BUILDS} times.`;
  return null;
}
