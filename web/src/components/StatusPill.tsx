import type { InitiativeStatus, RunStatus, TicketStatus } from '@factory/shared';
import { initiativeStatus, runStatus, shortVerdict, ticketStatus, verdictTone } from '@/lib/status';
import { Pill } from './ui';

export function InitiativePill({ status }: { status: InitiativeStatus }) {
  const s = initiativeStatus[status] ?? { label: status, tone: 'neutral' as const };
  return (
    <Pill tone={s.tone} live={s.live}>
      {s.label}
    </Pill>
  );
}

export function TicketPill({ status }: { status: TicketStatus }) {
  const s = ticketStatus[status] ?? { label: status, tone: 'neutral' as const };
  return (
    <Pill tone={s.tone} live={s.live}>
      {s.label}
    </Pill>
  );
}

export function RunPill({ status }: { status: RunStatus }) {
  const s = runStatus[status] ?? { label: status, tone: 'neutral' as const };
  return (
    <Pill tone={s.tone} live={s.live}>
      {s.label}
    </Pill>
  );
}

export function VerdictPill({ verdict }: { verdict: string | null | undefined }) {
  const v = shortVerdict(verdict);
  if (!v) return null;
  return (
    <Pill tone={verdictTone(verdict)} dot={false} className="font-mono uppercase tracking-wide">
      {v}
    </Pill>
  );
}
