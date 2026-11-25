import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Loader2, Sparkles, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { TONE, type Tone } from '@/design/tone';
import { cn } from '@/lib/utils';
import { Dot } from './badge';

const CALLOUT_ICONS: Record<Tone, LucideIcon> = {
  neutral: Info,
  muted: Info,
  accent: Sparkles,
  info: Info,
  active: Loader2,
  good: CheckCircle2,
  warn: AlertTriangle,
  bad: AlertOctagon,
};

/** The design system's Banner: a tinted box that says what is going on, and what you can do about it. */
export function Callout({
  tone = 'neutral',
  icon,
  title,
  children,
  actions,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const Icon = CALLOUT_ICONS[tone];
  return (
    <div className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3.5 py-3', TONE[tone].wash, TONE[tone].line, className)}>
      <span className={cn('mt-0.5 flex shrink-0 [&_svg]:size-4', TONE[tone].ink)}>{icon ?? <Icon className={cn(tone === 'active' && 'animate-spin [animation-duration:2.4s]')} />}</span>
      <div className="min-w-0 flex-1 basis-60">
        {title && <div className="text-sm font-medium text-ink">{title}</div>}
        {children && <div className={cn('text-pretty text-sm text-ink-secondary', title && 'mt-0.5')}>{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 self-center">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, actions, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-4 grid size-11 place-items-center rounded-xl bg-neutral-subtle text-ink-secondary [&_svg]:size-5">{icon}</div>}
      <h3 className="heading text-md text-ink">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-pretty text-sm leading-relaxed text-ink-secondary">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-neutral-subtle', className)} aria-hidden>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-[var(--app-hover)] to-transparent" />
    </div>
  );
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <Loader2 role="status" aria-label={label} className={cn('size-4 animate-spin text-ink-tertiary', className)} />;
}

export function ProgressBar({ value, tone = 'accent', indeterminate, className, label }: { value?: number; tone?: Tone; indeterminate?: boolean; className?: string; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-neutral-subtle', className)}
    >
      {indeterminate ? (
        <div className={cn('absolute inset-y-0 left-0 w-2/5 animate-progress rounded-full', TONE[tone].bar)} />
      ) : (
        <div className={cn('h-full rounded-full transition-[width] duration-500 ease-framework', TONE[tone].bar)} style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}

export interface Segment {
  value: number;
  tone: Tone;
  label: string;
}

/** Ticket progress as one bar. The legend names every colour, so the bar never needs explaining. */
export function SegmentedBar({ segments, className, legend }: { segments: Segment[]; className?: string; legend?: boolean }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const shown = segments.filter((s) => s.value > 0);
  const summary = shown.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(', ');
  return (
    <div className={className}>
      <div role="img" aria-label={summary || 'No tickets yet'} className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-neutral-subtle">
        {total > 0 &&
          shown.map((s) => (
            <div key={s.label} title={`${s.label}: ${s.value}`} className={cn('h-full first:rounded-l-full last:rounded-r-full', TONE[s.tone].bar)} style={{ width: `${(s.value / total) * 100}%` }} />
          ))}
      </div>
      {legend && shown.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {shown.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <Dot tone={s.tone} />
              <span className="numeric text-ink">{s.value}</span>
              {s.label.toLowerCase()}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
