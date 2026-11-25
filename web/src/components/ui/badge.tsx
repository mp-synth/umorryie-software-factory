import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { TONE, type Tone } from '@/design/tone';
import { copyWithToast } from '@/lib/toasts';
import { cn } from '@/lib/utils';

/** A status label. Square-cornered like the design system's Badge, with an optional dot that pulses while live. */
export function Badge({
  tone = 'neutral',
  dot,
  live,
  icon,
  children,
  title,
  className,
}: {
  tone?: Tone;
  dot?: boolean;
  live?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 text-xs font-medium [&_svg]:size-3.5', TONE[tone].badge, className)}
    >
      {dot && <Dot tone={tone} live={live} />}
      {icon}
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral', live, className }: { tone?: Tone; live?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-[0.43rem] shrink-0', className)} aria-hidden>
      {live && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', TONE[tone].dot)} />}
      <span className={cn('relative size-full rounded-full', TONE[tone].dot)} />
    </span>
  );
}

export const LiveDot = ({ className }: { className?: string }) => <Dot tone="active" live className={className} />;

export function Count({ n, tone = 'neutral', className }: { n: number; tone?: Tone; className?: string }) {
  return (
    <span className={cn('numeric inline-flex h-[1.2rem] min-w-[1.2rem] items-center justify-center rounded-full px-1.5 text-2xs font-medium', TONE[tone].badge, className)}>
      {n}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('inline-flex h-[1.3rem] min-w-[1.3rem] items-center justify-center rounded-xs border border-line bg-sunken px-1 font-sans text-2xs font-medium text-ink-secondary', className)}>
      {children}
    </kbd>
  );
}

/** Metadata in a row of facts: a project, a branch, a cost. `mono` for names a user may type. */
export function Chip({ icon, children, mono, title, className }: { icon?: ReactNode; children: ReactNode; mono?: boolean; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-md bg-neutral-subtle px-2 text-xs text-ink-secondary [&_svg]:size-3.5 [&_svg]:shrink-0',
        mono && 'font-mono',
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function CopyChip({ value, display, icon, label = 'Copied' }: { value: string; display?: string; icon?: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => copyWithToast(value, label)}
      title={`Copy ${value}`}
      className="group inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-md bg-neutral-subtle px-2 font-mono text-xs text-ink-secondary transition-colors duration-quick hover:bg-neutral-subtle-hover hover:text-ink [&_svg]:size-3.5 [&_svg]:shrink-0"
    >
      {icon}
      <span className="truncate">{display ?? value}</span>
      <Copy className="opacity-50 group-hover:opacity-100" />
    </button>
  );
}
