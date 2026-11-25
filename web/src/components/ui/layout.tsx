import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TONE, type Tone } from '@/design/tone';
import { cn } from '@/lib/utils';
import { LiveDot } from './badge';

export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={cn('rounded-xl border border-line-subtle bg-panel shadow-xs', className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-subtle px-4 py-3', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-neutral-subtle text-ink-secondary [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-base font-medium text-ink">{title}</h2>
          {description && <div className="truncate text-xs text-ink-tertiary">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

const PAGE_WIDTHS = { narrow: 'max-w-[880px]', default: 'max-w-[1280px]', wide: 'max-w-[1600px]' };

export function Page({ children, width = 'default', className }: { children: ReactNode; width?: keyof typeof PAGE_WIDTHS; className?: string }) {
  return <div className={cn('mx-auto w-full px-5 pb-12 pt-6 @lg:px-8 @lg:pt-7', PAGE_WIDTHS[width], className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
  status,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex flex-wrap items-start gap-x-6 gap-y-4', className)}>
      <div className="min-w-0 flex-1 basis-80">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="heading text-2xl text-ink">{title}</h1>
          {status}
        </div>
        {description && <p className="mt-1.5 max-w-3xl text-pretty text-sm leading-relaxed text-ink-secondary">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-1.5">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, actions, children, className, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-4', className)}>
      <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="heading text-lg text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-pretty text-sm text-ink-secondary">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** One number the user scans for: what it counts, its value, and a line of context. Links go to the detail. */
export function Stat({
  label,
  value,
  sub,
  icon,
  tone,
  to,
  live,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  to?: string;
  live?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-xs font-medium text-ink-secondary [&_svg]:size-3.5">
        {icon}
        <span className="truncate">{label}</span>
        {live && <LiveDot className="ml-auto" />}
        {to && !live && <ArrowUpRight className="ml-auto text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <div className={cn('numeric heading mt-2.5 text-2xl', tone ? TONE[tone].ink : 'text-ink')}>{value}</div>
      {sub && <div className="mt-1 truncate text-xs text-ink-tertiary">{sub}</div>}
    </>
  );
  const className = cn('block min-w-0 rounded-xl border bg-panel px-4 py-3.5 shadow-xs', tone === 'warn' ? 'border-tone-warn-line' : 'border-line-subtle');
  return to ? (
    <Link to={to} className={cn(className, 'group transition-colors duration-quick hover:border-line hover:bg-hover')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
