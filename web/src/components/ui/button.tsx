import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Tooltip } from './overlay';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'danger-ghost';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

/** Framework 26 paints: solid lead color, a neutral fill, an outline, plain, and their destructive pair. */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-ink-on-primary hover:bg-primary-hover active:bg-primary-pressed disabled:bg-disabled disabled:text-ink-disabled',
  secondary: 'bg-neutral-subtle text-ink hover:bg-neutral-subtle-hover active:bg-neutral-subtle-pressed disabled:bg-disabled disabled:text-ink-disabled',
  outline: 'border border-line bg-transparent text-ink hover:border-line-strong hover:bg-hover active:bg-pressed disabled:border-disabled-line disabled:text-ink-disabled',
  ghost: 'text-ink-secondary hover:bg-hover hover:text-ink active:bg-pressed disabled:text-ink-disabled',
  danger: 'bg-bad text-ink-on-bad hover:bg-bad-hover active:bg-bad-pressed disabled:bg-disabled disabled:text-ink-disabled',
  'danger-ghost': 'text-ink-bad hover:bg-bad-subtle-hover active:bg-bad-subtle-pressed disabled:text-ink-disabled',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-control-xs gap-1 rounded-md px-2 text-xs [&_svg]:size-3',
  sm: 'h-control-sm gap-1.5 rounded-md px-2.5 text-sm [&_svg]:size-3.5',
  md: 'h-control-md gap-2 rounded-lg px-3 text-base [&_svg]:size-4',
  lg: 'h-control-lg gap-2 rounded-lg px-4 text-md [&_svg]:size-4',
};

const SQUARE: Record<ButtonSize, string> = {
  xs: 'w-control-xs px-0',
  sm: 'w-control-sm px-0',
  md: 'w-control-md px-0',
  lg: 'w-control-lg px-0',
};

interface ButtonLook {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Trailing content, such as a count or a keyboard shortcut. */
  end?: ReactNode;
}

const buttonClasses = ({ variant = 'secondary', size = 'md' }: ButtonLook, className?: string) =>
  cn(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-quick ease-framework disabled:pointer-events-none [&_svg]:shrink-0',
    VARIANTS[variant],
    SIZES[size],
    className,
  );

export interface ButtonProps extends ButtonLook, ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, icon, end, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size }, className)}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children}
      {end}
    </button>
  );
});

/** A link that looks like a button, for actions that navigate. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLook & LinkProps>(function ButtonLink(
  { variant, size, icon, end, className, children, ...props },
  ref,
) {
  return (
    <Link ref={ref} className={buttonClasses({ variant, size }, className)} {...props}>
      {icon}
      {children}
      {end}
    </Link>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'end' | 'children'> {
  /** Shown as the tooltip and read by screen readers: every icon button says what it does. */
  label: string;
  icon: ReactNode;
  shortcut?: string;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, shortcut, tooltipSide, size = 'sm', variant = 'ghost', className, ...props },
  ref,
) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <Button ref={ref} aria-label={label} variant={variant} size={size} icon={icon} className={cn(SQUARE[size], className)} {...props} />
    </Tooltip>
  );
});
