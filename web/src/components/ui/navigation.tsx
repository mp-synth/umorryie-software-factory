import { ChevronRight } from 'lucide-react';
import { Fragment, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '@/design/tone';
import { cn } from '@/lib/utils';
import { Count, Dot } from './badge';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  countTone?: Tone;
  /** A status dot after the label, for a tab that holds something waiting on the user. */
  dot?: Tone;
  disabled?: boolean;
}

/** Arrow keys move between tabs; the selected tab carries Framework's accent "selected" border. */
export function Tabs<T extends string>({ value, onChange, items, className, label }: { value: T; onChange: (v: T) => void; items: TabItem<T>[]; className?: string; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = items.filter((t) => !t.disabled);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = enabled.findIndex((t) => t.value === value);
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    onChange(next.value);
    refs.current[items.indexOf(next)]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn('no-scrollbar flex items-end gap-1 overflow-x-auto border-b border-line-subtle', className)}>
      {items.map((t, i) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => (refs.current[i] = el)}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative -mb-px flex h-control-md shrink-0 items-center gap-2 whitespace-nowrap rounded-t-md px-2.5 text-sm font-medium transition-colors duration-quick [&_svg]:size-4',
              selected ? 'text-ink' : 'text-ink-secondary hover:text-ink disabled:text-ink-disabled',
            )}
          >
            {t.icon && <span className={cn(selected ? 'text-ink' : 'text-ink-tertiary')}>{t.icon}</span>}
            {t.label}
            {t.count !== undefined && t.count > 0 && <Count n={t.count} tone={t.countTone ?? 'neutral'} />}
            {t.dot && <Dot tone={t.dot} />}
            <span className={cn('absolute inset-x-1 bottom-0 h-0.5 rounded-full transition-colors', selected ? 'bg-[var(--line-accent)]' : 'bg-transparent')} />
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'sm',
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: 'xs' | 'sm';
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex shrink-0 rounded-lg bg-neutral-subtle p-0.5 dark:bg-sunken', className)}>
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-quick [&_svg]:size-3.5',
              size === 'xs' ? 'h-[1.286rem] px-2 text-xs' : 'h-control-xs px-2.5 text-sm',
              selected ? 'bg-panel text-ink shadow-xs dark:bg-neutral-subtle' : 'text-ink-secondary hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface Crumb {
  label: ReactNode;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-ink-disabled" aria-hidden />}
            {c.to && !last ? (
              <Link to={c.to} className="shrink-0 truncate rounded-sm px-1 text-ink-secondary transition-colors hover:bg-hover hover:text-ink">
                {c.label}
              </Link>
            ) : (
              <span aria-current={last ? 'page' : undefined} className={cn('min-w-0 truncate px-1', last ? 'font-medium text-ink' : 'text-ink-secondary')}>
                {c.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
