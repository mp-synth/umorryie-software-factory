import type { InitiativeStatus, InitiativeSummary, RunStatus, TicketStatus } from '@factory/shared';
import { initiativeSignal } from '@/lib/initiative';
import { initiativeStatus, runStatus, shortVerdict, ticketStatus, verdictTone, type StatusInfo } from '@/lib/status';
import { Badge, Dot, Tooltip } from './ui';

function StatusBadge({ info, className }: { info: StatusInfo; className?: string }) {
  return (
    <Tooltip content={info.description}>
      <Badge tone={info.tone} dot live={info.live} className={className}>
        {info.label}
      </Badge>
    </Tooltip>
  );
}

export const InitiativeBadge = ({ status }: { status: InitiativeStatus }) => <StatusBadge info={initiativeStatus[status]} />;

export function TicketBadge({ status, arbitrating }: { status: TicketStatus; arbitrating?: boolean }) {
  if (status === 'blocked' && arbitrating) {
    return <StatusBadge info={{ label: 'Arbiter deciding', tone: 'active', live: true, description: 'It stopped, and a fresh arbiter is deciding for you.' }} />;
  }
  return <StatusBadge info={ticketStatus[status]} />;
}

/** `replaced`: a later run of the same agent took over, so a failure here no longer needs attention. */
export function RunBadge({ status, replaced }: { status: RunStatus; replaced?: boolean }) {
  const info = runStatus[status];
  return <StatusBadge info={replaced ? { ...info, tone: 'muted', description: 'A later run of the same agent replaced this one.' } : info} />;
}

export function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  const v = shortVerdict(verdict);
  if (!v) return null;
  return (
    <Badge tone={verdictTone(verdict)} title={verdict ?? undefined} className="font-mono text-2xs uppercase tracking-label">
      {v}
    </Badge>
  );
}

export function InitiativeGlyph({ initiative }: { initiative: InitiativeSummary }) {
  const s = initiativeSignal(initiative);
  return <Dot tone={s.tone} live={s.live} />;
}
