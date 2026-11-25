import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { AlertTriangle, Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Kbd } from './badge';
import { useConfirmRequest } from './confirm';

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={150}>
    {children}
  </TooltipPrimitive.Provider>
);

/** Tooltips paint an inverted surface, as Framework 26 surface polarity intends for small floating labels. */
export function Tooltip({
  content,
  shortcut,
  children,
  side = 'top',
  align = 'center',
}: {
  content: ReactNode;
  shortcut?: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          data-surface="inverted"
          className="z-[100] flex max-w-xs animate-fade-in items-center gap-2 rounded-md bg-canvas px-2 py-1 text-xs text-ink shadow-popover"
        >
          <span className="min-w-0">{content}</span>
          {shortcut && <Kbd className="border-line-subtle bg-transparent text-ink-secondary">{shortcut}</Kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

const DIALOG_SIZES = { sm: 'max-w-[440px]', md: 'max-w-[560px]', lg: 'max-w-[760px]', xl: 'max-w-[960px]' };

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  footer,
  footerStart,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  footerStart?: ReactNode;
  size?: keyof typeof DIALOG_SIZES;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 flex animate-fade-in justify-center overflow-y-auto bg-overlay px-4 pb-8 pt-[8vh] backdrop-blur-[2px]">
          <DialogPrimitive.Content
            {...(description ? {} : { 'aria-describedby': undefined })}
            onOpenAutoFocus={(e) => {
              const target = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-autofocus]');
              if (!target) return;
              e.preventDefault();
              target.focus();
            }}
            onEscapeKeyDown={(e) => {
              if (e.target instanceof HTMLElement && e.target.closest('[role="combobox"][aria-expanded="true"]')) e.preventDefault();
            }}
            className={cn(
              'relative flex h-fit max-h-[84vh] w-full animate-scale-in flex-col overflow-hidden rounded-2xl border border-line-subtle bg-raised shadow-dialog outline-none',
              DIALOG_SIZES[size],
            )}
          >
            <header className="flex items-start gap-3 px-5 pb-3 pt-5">
              {icon && <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-subtle text-ink-secondary [&_svg]:size-[18px]">{icon}</span>}
              <div className="min-w-0 flex-1 pt-0.5">
                <DialogPrimitive.Title className="heading text-lg text-ink">{title}</DialogPrimitive.Title>
                {description && <DialogPrimitive.Description className="mt-1 text-sm text-ink-secondary">{description}</DialogPrimitive.Description>}
              </div>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="sm" aria-label="Close" icon={<X />} className="-mr-1 -mt-1 w-control-sm px-0" />
              </DialogPrimitive.Close>
            </header>
            {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">{children}</div>}
            {(footer || footerStart) && (
              <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line-subtle bg-sunken/60 px-5 py-3">
                {footerStart && <div className="mr-auto min-w-0 text-xs text-ink-secondary">{footerStart}</div>}
                {footer}
              </footer>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ConfirmHost() {
  const { current, close } = useConfirmRequest();
  return (
    <Dialog
      open={!!current}
      onOpenChange={(open) => !open && close(false)}
      size="sm"
      icon={current?.danger ? <AlertTriangle className="text-ink-bad" /> : undefined}
      title={current?.title}
      description={current?.description}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} data-autofocus={current?.danger || undefined}>
            Cancel
          </Button>
          <Button variant={current?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus={!current?.danger || undefined}>
            {current?.confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export function Menu({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  return (
    <DropdownPrimitive.Root modal={false}>
      <DropdownPrimitive.Trigger asChild>{trigger}</DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn('z-[90] min-w-[220px] max-w-[340px] animate-scale-in rounded-xl border border-line-subtle bg-raised p-1 shadow-popover', className)}
        >
          {children}
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  );
}

const itemClass = (danger?: boolean) =>
  cn(
    'group flex min-h-control-sm cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors duration-quick data-[disabled]:pointer-events-none data-[disabled]:text-ink-disabled',
    danger ? 'text-ink-bad data-[highlighted]:bg-bad-subtle-hover' : 'text-ink data-[highlighted]:bg-hover',
  );

function ItemBody({ icon, children, description, hint, shortcut }: { icon?: ReactNode; children: ReactNode; description?: ReactNode; hint?: ReactNode; shortcut?: string }) {
  return (
    <>
      {icon !== undefined && (
        <span className="flex size-4 shrink-0 items-center justify-center self-start pt-0.5 text-ink-secondary group-data-[disabled]:text-ink-disabled [&_svg]:size-4">{icon}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {description && <span className="block text-xs text-ink-tertiary group-data-[disabled]:text-ink-disabled">{description}</span>}
      </span>
      {hint && <span className="shrink-0 text-xs text-ink-tertiary">{hint}</span>}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </>
  );
}

export function MenuItem({
  icon,
  children,
  description,
  onSelect,
  danger,
  disabled,
  hint,
  shortcut,
}: {
  icon?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  shortcut?: string;
}) {
  return (
    <DropdownPrimitive.Item disabled={disabled} onSelect={onSelect} className={itemClass(danger)}>
      <ItemBody icon={icon} description={description} hint={hint} shortcut={shortcut}>
        {children}
      </ItemBody>
    </DropdownPrimitive.Item>
  );
}

export function MenuRadioGroup<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[] }) {
  return (
    <DropdownPrimitive.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
      {options.map((o) => (
        <DropdownPrimitive.RadioItem key={o.value} value={o.value} className={itemClass()} onSelect={(e) => e.preventDefault()}>
          <ItemBody icon={o.icon} hint={o.value === value ? <Check className="size-4 text-ink-accent" /> : undefined}>
            {o.label}
          </ItemBody>
        </DropdownPrimitive.RadioItem>
      ))}
    </DropdownPrimitive.RadioGroup>
  );
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="-mx-1 my-1 h-px bg-line-subtle" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownPrimitive.Label className="eyebrow px-2 pb-1 pt-2">{children}</DropdownPrimitive.Label>;
}