import { cn } from '@/lib/utils';

/** The factory mark on the theme's lead colour, as the favicon draws it. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-ink-on-primary', className)} aria-hidden>
      <svg viewBox="0 0 32 32" className="size-[1.15rem]">
        <path d="M8 22V10l8 5 8-5v12" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
