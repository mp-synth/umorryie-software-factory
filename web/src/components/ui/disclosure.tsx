import { ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Count } from './badge';

/** A titled section the user opens on demand: the overview stays short, the detail stays one click away. */
export function Disclosure({
  label,
  icon,
  count,
  aside,
  children,
  defaultOpen,
  className,
}: {
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  aside?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors duration-quick hover:bg-hover"
      >
        <ChevronRight className={cn('size-4 shrink-0 text-ink-tertiary transition-transform duration-hover', open && 'rotate-90')} />
        {icon && <span className="flex shrink-0 text-ink-secondary [&_svg]:size-4">{icon}</span>}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{label}</span>
        {count !== undefined && <Count n={count} />}
        {aside}
      </button>
      {open && (
        <div id={id} className="animate-fade-in px-4 pb-4 pl-11">
          {children}
        </div>
      )}
    </div>
  );
}
