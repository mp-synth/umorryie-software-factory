import type { Ticket } from '@factory/shared';
import { seqLabel, ticketLabel } from './labels.ts';
import { oneLine } from './retro.ts';
import { section } from './plan.ts';

export interface Route {
  ref: string;
  instructions: string;
}

export function parseRoutes(md: string): Route[] {
  const heading = /^##\s+Ticket\s+(.+?)\s*$/gim;
  return [...md.matchAll(heading)]
    .map((m) => {
      const rest = md.slice(m.index! + m[0].length);
      const end = rest.search(/^##\s+/m);
      return { ref: m[1], instructions: (end === -1 ? rest : rest.slice(0, end)).trim() };
    })
    .filter((r) => r.instructions);
}

export function resolveTicketRef<T extends Pick<Ticket, 'key' | 'seq'>>(ref: string, tickets: T[]): T | null {
  const clean = ref.replace(/[`[\]()]/g, ' ').trim();
  const byKey = tickets.find((t) => clean.split(/\s+/).some((word) => word === t.key || word === `${seqLabel(t.seq)}-${t.key}`));
  if (byKey) return byKey;
  const seq = /^(\d{1,3})\b/.exec(clean);
  return seq ? tickets.find((t) => t.seq === Number(seq[1])) ?? null : null;
}

export interface TicketRoute<T> {
  ticket: T;
  instructions: string;
}

export function routesByTicket<T extends Pick<Ticket, 'id' | 'key' | 'seq'>>(routes: Route[], tickets: T[]): { routed: TicketRoute<T>[]; unknownRefs: string[] } {
  const routed = new Map<string, TicketRoute<T>>();
  const unknownRefs: string[] = [];
  for (const route of routes) {
    const ticket = resolveTicketRef(route.ref, tickets);
    if (!ticket) {
      unknownRefs.push(route.ref);
      continue;
    }
    const earlier = routed.get(ticket.id);
    if (earlier) earlier.instructions = `${earlier.instructions}\n\n${route.instructions}`;
    else routed.set(ticket.id, { ticket, instructions: route.instructions });
  }
  return { routed: [...routed.values()], unknownRefs };
}

export function routeReason(md: string): string {
  return oneLine(section(md, 'Reason') ?? '');
}

const NO_CHANGES_STATUSES: Ticket['status'][] = ['merged', 'canceled', 'proposed'];

export function routeBlocker(t: Pick<Ticket, 'status'>): string | null {
  return NO_CHANGES_STATUSES.includes(t.status) ? `it is ${t.status}` : null;
}

const diffBaseOf = (t: Pick<Ticket, 'baseRef'>, baseBranch: string) => (t.baseRef?.startsWith('factory/') ? t.baseRef : `origin/${t.baseRef ?? baseBranch}`);

type ListedTicket = Pick<Ticket, 'seq' | 'title' | 'key' | 'status' | 'branch' | 'worktreePath' | 'prUrl' | 'prState' | 'dependsOn' | 'what' | 'baseRef'>;

export function renderTicketsForSteering(tickets: ListedTicket[], baseBranch: string): string {
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  return [
    '# Tickets of this initiative',
    '',
    'Each ticket is one branch and one PR. A stacked ticket builds on the ticket below it, and every change pushed to a lower PR is merged into the PRs above it by the factory.',
    '',
    ...tickets.flatMap((t) => {
      const below = t.dependsOn.map((k) => byKey.get(k)).filter(Boolean)[0];
      const blocker = routeBlocker(t);
      return [
        `## ${ticketLabel(t)} (key ${t.key})`,
        '',
        `- Status: ${t.status}${blocker ? ` (can't take changes: ${blocker})` : ''}`,
        `- Builds on: ${below ? `${ticketLabel(below)} (key ${below.key})` : `\`${baseBranch}\``}`,
        t.prUrl ? `- PR: ${t.prUrl}${t.prState ? ` (${t.prState})` : ''}` : '- PR: none yet',
        t.branch ? `- Branch: ${t.branch}` : '- Branch: not started',
        t.worktreePath ? `- Worktree: ${t.worktreePath} (diff: \`git -C ${t.worktreePath} diff ${diffBaseOf(t, baseBranch)}...HEAD\`)` : '',
        `- What: ${oneLine(t.what)}`,
        '',
      ].filter((l, i, all) => l !== '' || all[i - 1] !== '');
    }),
  ].join('\n');
}
