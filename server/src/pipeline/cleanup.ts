import type { Ticket, TicketStatus } from '@factory/shared';

type CleanupFields = Pick<Ticket, 'status' | 'branch' | 'baseRef' | 'worktreePath'>;

export interface MergedTicketCleanup<T extends CleanupFields> {
  ticket: T;
  branchToDelete: string | null;
}

const FINISHED: TicketStatus[] = ['merged', 'canceled'];

export function mergedTicketCleanups<T extends CleanupFields>(tickets: T[]): MergedTicketCleanup<T>[] {
  const basesInUse = new Set(tickets.filter((t) => !FINISHED.includes(t.status)).map((t) => t.baseRef));
  return tickets
    .filter((t) => t.status === 'merged')
    .map((ticket) => ({ ticket, branchToDelete: ticket.branch && !basesInUse.has(ticket.branch) ? ticket.branch : null }))
    .filter(({ ticket, branchToDelete }) => ticket.worktreePath || branchToDelete);
}
