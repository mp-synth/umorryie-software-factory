import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import {
  forwardRef,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';
import { toneClasses, type Tone } from '@/lib/status';


type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'success';
type Size = 'xs' | 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-violet-500 to-indigo-600 text-white shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset,0_6px_20px_-8px_rgba(124,108,255,0.7)] hover:from-violet-400 hover:to-indigo-500 border border-violet-400/30',
  secondary: 'bg-surface-3 text-zinc-200 border border-line-strong hover:bg-[#23232d] hover:text-white',
  outline: 'border border-line-strong text-zinc-300 hover:bg-white/[0.04] hover:text-white',
  ghost: 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100',
  danger: 'bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20',
  success: 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/30 hover:bg-emerald-500/25',
};
const sizes: Record<Size, string> = {
  xs: 'h-6 px-2 text-2xs gap-1 rounded-md',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-[34px] px-3.5 text-[13px] gap-2 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { label, size = 'sm', className, ...props },
  ref,
) {
  return (
    <Tooltip content={label}>
      <Button ref={ref} aria-label={label} variant="ghost" size={size} className={cn(size === 'xs' ? 'w-6 px-0' : 'w-7 px-0', className)} {...props} />
    </Tooltip>
  );
});


export function Pill({ tone = 'neutral', live, children, className, dot = true }: { tone?: Tone; live?: boolean; children: ReactNode; className?: string; dot?: boolean }) {
  const t = toneClasses[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[2px] text-2xs font-medium ring-1 ring-inset', t.pill, className)}>
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {live && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', t.dot)} />}
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', t.dot)} />
        </span>
      )}
      {children}
    </span>
  );
}

export function Chip({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('mono-chip max-w-full truncate', className)}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-3 px-1 py-px font-mono text-[10px] text-zinc-400">{children}</kbd>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-3.5 w-3.5 animate-spin text-zinc-500', className)} />;
}


export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('card', className)}>{children}</section>;
}

export function CardHeader({ title, icon, right, sub, className }: { title: ReactNode; icon?: ReactNode; right?: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {icon && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-zinc-400">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-[13.5px] font-semibold text-zinc-100">{title}</h2>
          {sub && <div className="truncate text-2xs text-zinc-500">{sub}</div>}
        </div>
      </div>
      {right && <div className="flex flex-wrap items-center gap-1.5">{right}</div>}
    </div>
  );
}


const fieldBase =
  'w-full rounded-lg border border-line-strong bg-black/30 px-3 text-[13px] text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(fieldBase, 'h-9', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-[80px] resize-y py-2 leading-relaxed', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(fieldBase, 'h-9 appearance-none pr-8', className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
    </div>
  );
});

export function Field({ label, hint, children, className, group }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; group?: boolean }) {
  const Wrapper = group ? 'div' : 'label';
  return (
    <Wrapper className={cn('block space-y-1.5', className)}>
      <span className="block text-xs font-medium text-zinc-300">{label}</span>
      {children}
      {hint && <span className="block text-2xs leading-relaxed text-zinc-500">{hint}</span>}
    </Wrapper>
  );
}

const COMBOBOX_LIMIT = 100;

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const shown = matches.slice(0, COMBOBOX_LIMIT);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.max(0, Math.min(shown.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && open && shown[active]) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <input
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        value={open ? query : value}
        placeholder={open ? value || placeholder : placeholder}
        onFocus={() => (setOpen(true), setQuery(''), setActive(0))}
        onBlur={() => setOpen(false)}
        onChange={(e) => (setQuery(e.target.value), setActive(0), setOpen(true))}
        onKeyDown={onKeyDown}
        className={cn(fieldBase, 'h-9 pr-8')}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line-strong bg-surface-2 py-1 shadow-2xl">
          {shown.map((o, i) => (
            <li key={o} role="option" aria-selected={o === value}>
              <button
                type="button"
                onMouseDown={(e) => (e.preventDefault(), pick(o))}
                onMouseEnter={() => setActive(i)}
                className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-300', i === active && 'bg-white/[0.06] text-zinc-100')}
              >
                <span className="min-w-0 flex-1 truncate">{o}</span>
                {o === value && <Check className="h-3.5 w-3.5 shrink-0 text-violet-300" />}
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-3 py-1.5 text-xs text-zinc-500">No match</li>}
          {matches.length > shown.length && (
            <li className="px-3 py-1.5 text-2xs text-zinc-500">{matches.length - shown.length} more · type to narrow</li>
          )}
        </ul>
      )}
    </div>
  );
}

export function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const v = raw.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-black/30 px-2 py-1.5 transition-colors focus-within:border-violet-400/60 focus-within:ring-2 focus-within:ring-violet-500/20">
      {values.map((v) => (
        <span key={v} className="mono-chip inline-flex max-w-full items-center gap-1">
          <span className="truncate">{v}</span>
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-zinc-500 hover:text-zinc-200">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft && add(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        placeholder={values.length ? '' : placeholder}
        className="h-6 min-w-[10rem] flex-1 bg-transparent px-1 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
      />
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <SwitchPrimitive.Root
      aria-label={label}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className="relative h-[18px] w-8 shrink-0 rounded-full border border-line-strong bg-surface-3 transition-colors data-[state=checked]:border-violet-400/50 data-[state=checked]:bg-violet-500/70 disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block h-3 w-3 translate-x-[2px] rounded-full bg-zinc-300 shadow transition-transform data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-white" />
    </SwitchPrimitive.Root>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = 'sm' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: 'sm' | 'xs' }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-black/30 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
            size === 'xs' ? 'h-6 px-2 text-2xs' : 'h-7 px-2.5 text-xs',
            value === o.value ? 'bg-surface-3 text-zinc-100 shadow-sm ring-1 ring-line-strong' : 'text-zinc-500 hover:text-zinc-300',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}


export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[100] max-w-xs animate-fade-in rounded-md border border-line-strong bg-[#1d1d26] px-2 py-1 text-2xs text-zinc-200 shadow-xl"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;


export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          onEscapeKeyDown={(e) => {
            if (e.target instanceof HTMLElement && e.target.closest('[role="combobox"][aria-expanded="true"]')) e.preventDefault();
          }}
          className={cn(
            'fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-2xl border border-line-strong bg-surface shadow-2xl data-[state=open]:animate-fade-in',
            wide ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-[15px] font-semibold text-zinc-100">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="mt-0.5 text-xs text-zinc-500">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200" aria-label="Close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}


export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <DropdownPrimitive.Root modal={false}>
      <DropdownPrimitive.Trigger asChild>{trigger}</DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content
          align={align}
          sideOffset={6}
          className="z-[90] min-w-[200px] animate-fade-in rounded-xl border border-line-strong bg-[#17171e] p-1 shadow-2xl"
        >
          {children}
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  );
}

export function MenuItem({ icon, children, onSelect, danger, disabled, hint }: { icon?: ReactNode; children: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: ReactNode }) {
  return (
    <DropdownPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs outline-none transition-colors data-[disabled]:opacity-40',
        danger ? 'text-rose-300 data-[highlighted]:bg-rose-500/10' : 'text-zinc-300 data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-white',
      )}
    >
      <span className="flex h-4 w-4 items-center justify-center text-zinc-500 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      <span className="flex-1">{children}</span>
      {hint && <span className="text-2xs text-zinc-600">{hint}</span>}
    </DropdownPrimitive.Item>
  );
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownPrimitive.Label className="px-2.5 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wider text-zinc-600">{children}</DropdownPrimitive.Label>;
}


export function SegmentedBar({ segments, className }: { segments: { value: number; tone: Tone; label?: string }[]; className?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]', className)}>
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s, i) => (
            <div
              key={i}
              title={s.label ? `${s.label}: ${s.value}` : undefined}
              className={cn('h-full transition-all duration-500', toneClasses[s.tone].bar)}
              style={{ width: `${(s.value / total) * 100}%` }}
            />
          ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-line bg-surface-2 text-zinc-500 [&>svg]:h-5 [&>svg]:w-5">{icon}</div>}
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      {children && <p className="mt-1.5 max-w-md text-xs leading-relaxed text-zinc-500">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-white/[0.04]', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
    </div>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return <span className={cn('h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400', className)} />;
}
