import type { Initiative, Ticket } from '@factory/shared';
import { ticketLabel } from './labels.ts';

export interface ReportInput {
  initiative: Pick<Initiative, 'title' | 'planJson'>;
  tickets: Pick<Ticket, 'seq' | 'title' | 'status' | 'lastVerdict' | 'prUrl'>[];
  costUsd: number;
}

export function renderReport({ initiative, tickets, costUsd }: ReportInput): string {
  const ticketLines = tickets.length
    ? [...tickets]
        .sort((a, b) => a.seq - b.seq)
        .map(
          (t) =>
            `- ${ticketLabel(t)} — ${t.status} — ${t.lastVerdict ?? 'no verdict'}` +
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
    `Agent spend: ${costUsd > 0 && costUsd < 0.01 ? '<$0.01' : `$${costUsd.toFixed(2)}`}`,
  ].join('\n') + '\n';
}
