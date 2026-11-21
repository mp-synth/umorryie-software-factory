import type { Initiative, Ticket } from '@factory/shared';

export interface ReportInput {
  initiative: Pick<Initiative, 'title' | 'planJson'>;
  tickets: Pick<Ticket, 'seq' | 'title' | 'status' | 'lastVerdict' | 'prUrl'>[];
  costUsd: number;
}

/** Short markdown status report for standups and Slack. Shared by GET /report and the UI copy button. */
export function renderReport({ initiative, tickets, costUsd }: ReportInput): string {
  const ticketLines = tickets.length
    ? [...tickets]
        .sort((a, b) => a.seq - b.seq)
        .map(
          (t) =>
            `- [${String(t.seq).padStart(2, '0')}] ${t.title} — ${t.status} — ${t.lastVerdict ?? 'no verdict'}` +
            (t.prUrl ? ` — ${t.prUrl}` : ''),
        )
    : ['- _No tickets yet._'];
  return [
    `# ${initiative.title}`,
    '',
    `Goal: ${initiative.planJson?.goal ?? '_no plan yet_'}`,
    '',
    ...ticketLines,
    '',
    `Agent spend: $${costUsd.toFixed(2)}`,
  ].join('\n') + '\n';
}
