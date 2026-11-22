import type { RunKind } from '@factory/shared';

export interface SchedulableRun {
  id: string;
  initiativeId: string;
  ticketId: string | null;
  kind: RunKind;
}

export interface QueuedRun extends SchedulableRun {
  concurrency: number;
}

export function pickRunsToStart<Q extends QueuedRun>(queuedOldestFirst: Q[], running: SchedulableRun[], slots: number): Q[] {
  const agentsPerInitiative = new Map<string, number>();
  const busyTickets = new Map<string, Set<string>>();
  const occupy = (r: SchedulableRun) => {
    agentsPerInitiative.set(r.initiativeId, (agentsPerInitiative.get(r.initiativeId) ?? 0) + 1);
    if (!r.ticketId || r.kind === 'ask') return;
    const tickets = busyTickets.get(r.initiativeId) ?? new Set<string>();
    tickets.add(r.ticketId);
    busyTickets.set(r.initiativeId, tickets);
  };
  const fitsTicketLimit = (q: Q) => {
    if (!q.ticketId || q.kind === 'ask') return true;
    const tickets = busyTickets.get(q.initiativeId);
    return !tickets || tickets.has(q.ticketId) || tickets.size < q.concurrency;
  };
  const load = (q: Q) => agentsPerInitiative.get(q.initiativeId) ?? 0;

  running.forEach(occupy);
  const waiting = [...queuedOldestFirst];
  const picked: Q[] = [];
  while (picked.length < slots) {
    let best = -1;
    waiting.forEach((q, i) => {
      if (fitsTicketLimit(q) && (best === -1 || load(q) < load(waiting[best]))) best = i;
    });
    if (best === -1) break;
    const [next] = waiting.splice(best, 1);
    picked.push(next);
    occupy(next);
  }
  return picked;
}
