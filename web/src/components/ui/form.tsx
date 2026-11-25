import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Check, ChevronDown, Minus, Plus, X } from 'lucide-react';
import {
  forwardRef,
  useId,
  useMemo,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

type FieldSize = 'sm' | 'md';

/** The earlier design system's input focus: the border turns to the focus colour inside a pale accent ring. */
const fieldBase =
  'w-full rounded-lg border border-line bg-panel text-ink placeholder:text-ink-tertiary transition-[border-color,box-shadow] duration-quick hover:border-line-strong focus:border-line-focus focus:shadow-[0_0_0_3px_var(--fill-accent-subtle)] focus:outline-none disabled:cursor-not-allowed disabled:border-disabled-line disabled:bg-disabled disabled:text-ink-disabled aria-[invalid=true]:border-line-bad';

const fieldSizes: Record<FieldSize, string> = {
  sm: 'h-control-sm px-2.5 text-sm',
  md: 'h-control-md px-3 text-base',
};

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: FieldSize; leading?: ReactNode };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, size = 'md', leading, ...props }, ref) {
  if (!leading) return <input ref={ref} className={cn(fieldBase, fieldSizes[size], className)} {...props} />;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2 text-ink-tertiary [&_svg]:size-4">{leading}</span>
      <input ref={ref} className={cn(fieldBase, fieldSizes[size], 'pl-8', className)} {...props} />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-[5.5rem] resize-y px-3 py-2 text-base leading-relaxed', className)} {...props} />;
});

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: FieldSize };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, size = 'md', children, ...props }, ref) {
  return (
    <div className="relative min-w-0">
      <select ref={ref} className={cn(fieldBase, fieldSizes[size], 'appearance-none truncate pr-8', className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-tertiary" />
    </div>
  );
});

export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className,
  group,
  aside,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
  /** Use a div instead of a label when the control already labels itself (comboboxes, tag inputs). */
  group?: boolean;
  aside?: ReactNode;
}) {
  const Wrapper = group ? 'div' : 'label';
  return (
    <Wrapper className={cn('block space-y-1.5', className)}>
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <span className="min-w-0 flex-1">
          {label}
          {optional && <span className="ml-1.5 font-normal text-ink-tertiary">optional</span>}
        </span>
        {aside}
      </span>
      {children}
      {error ? (
        <span className="block text-xs text-ink-bad">{error}</span>
      ) : (
        hint && <span className="block text-pretty text-xs leading-relaxed text-ink-tertiary">{hint}</span>
      )}
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
  const listId = useId();
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
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        value={open ? query : value}
        placeholder={open ? value || placeholder : placeholder}
        onFocus={() => (setOpen(true), setQuery(''), setActive(0))}
        onBlur={() => setOpen(false)}
        onChange={(e) => (setQuery(e.target.value), setActive(0), setOpen(true))}
        onKeyDown={onKeyDown}
        className={cn(fieldBase, fieldSizes.md, 'pr-8')}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-tertiary" />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full animate-scale-in overflow-y-auto rounded-lg border border-line-subtle bg-raised p-1 shadow-popover">
          {shown.map((o, i) => (
            <li key={o} role="option" aria-selected={o === value}>
              <button
                type="button"
                onMouseDown={(e) => (e.preventDefault(), pick(o))}
                onMouseEnter={() => setActive(i)}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink', i === active && 'bg-hover')}
              >
                <span className="min-w-0 flex-1 truncate">{o}</span>
                {o === value && <Check className="size-4 shrink-0 text-ink-accent" />}
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-2 py-1.5 text-sm text-ink-tertiary">No match</li>}
          {matches.length > shown.length && <li className="px-2 py-1.5 text-xs text-ink-tertiary">{matches.length - shown.length} more · type to narrow</li>}
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
    <div className={cn(fieldBase, 'flex min-h-control-md flex-wrap items-center gap-1.5 px-1.5 py-1 focus-within:border-line-focus focus-within:shadow-[0_0_0_3px_var(--fill-accent-subtle)]')}>
      {values.map((v) => (
        <span key={v} className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-neutral-subtle pl-2 pr-1 font-mono text-xs text-ink">
          <span className="truncate">{v}</span>
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="rounded-xs p-0.5 text-ink-tertiary hover:bg-hover hover:text-ink">
            <X className="size-3" />
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
        placeholder={values.length ? 'Add another…' : placeholder}
        className="h-6 min-w-[10rem] flex-1 bg-transparent px-1.5 font-mono text-sm text-ink placeholder:font-sans placeholder:text-ink-tertiary focus:outline-none"
      />
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label, id }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; id?: string }) {
  return (
    <SwitchPrimitive.Root
      id={id}
      aria-label={label}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className="relative inline-flex h-[1.286rem] w-[2.143rem] shrink-0 items-center rounded-full bg-neutral-secondary transition-colors duration-hover ease-framework data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block size-[0.929rem] translate-x-[0.179rem] rounded-full bg-white shadow-xs transition-transform duration-hover ease-spring data-[state=checked]:translate-x-[1.036rem] data-[state=checked]:bg-[var(--ink-on-accent)]" />
    </SwitchPrimitive.Root>
  );
}

/** A setting you turn on or off: the whole row is the hit area, and the description says what changes. */
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-4 px-4 py-3', className)}>
      <label htmlFor={id} className={cn('min-w-0 flex-1', !disabled && 'cursor-pointer')}>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-pretty text-xs leading-relaxed text-ink-secondary">{description}</span>}
      </label>
      <span className="pt-0.5">
        <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
      </span>
    </div>
  );
}

export function NumberStepper({ label, value, min, max, onChange, hint }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; hint?: string }) {
  const step = (d: number) => onChange(Math.max(min, Math.min(max, value + d)));
  return (
    <div className="min-w-0" title={hint}>
      <span className="block truncate text-xs text-ink-secondary">{label}</span>
      <div className="mt-1 flex h-control-sm items-center rounded-lg border border-line bg-panel">
        <button type="button" aria-label={`Decrease ${label}`} className="grid h-full w-7 place-items-center text-ink-secondary hover:text-ink disabled:text-ink-disabled" disabled={value <= min} onClick={() => step(-1)}>
          <Minus className="size-3.5" />
        </button>
        <span className="numeric flex-1 text-center text-sm text-ink" aria-live="polite">
          {value}
        </span>
        <button type="button" aria-label={`Increase ${label}`} className="grid h-full w-7 place-items-center text-ink-secondary hover:text-ink disabled:text-ink-disabled" disabled={value >= max} onClick={() => step(1)}>
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export interface OptionCard<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  preview?: ReactNode;
}

/** A visible choice between a few options, each with a preview: settings where seeing beats reading. */
export function OptionCards<T extends string>({
  value,
  onChange,
  options,
  label,
  columns = 3,
}: {
  value: T;
  onChange: (v: T) => void;
  options: OptionCard<T>[];
  label: string;
  columns?: 2 | 3 | 4;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2', { 2: 'grid-cols-2', 3: 'grid-cols-2 @md:grid-cols-3', 4: 'grid-cols-2 @md:grid-cols-4' }[columns])}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              'group relative flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors duration-quick',
              selected ? 'border-line-accent bg-accent-subtle/40 shadow-[inset_0_0_0_1px_var(--line-accent)]' : 'border-line-subtle hover:border-line hover:bg-hover',
            )}
          >
            {o.preview}
            <span className="flex items-start gap-2 px-0.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{o.label}</span>
                {o.description && <span className="block text-xs text-ink-tertiary">{o.description}</span>}
              </span>
              <span
                className={cn(
                  'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors',
                  selected ? 'border-transparent bg-accent text-ink-on-accent' : 'border-line-strong text-transparent',
                )}
              >
                <Check className="size-2.5" strokeWidth={3} />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
