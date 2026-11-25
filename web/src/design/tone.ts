/**
 * @fileoverview Tailwind class sets per status tone and per identity hue. Status tones carry meaning
 * (live, needs you, failed); hues only tell agent kinds apart. `wash` is `fill` for large areas, which
 * Framework's dark 800 steps would otherwise paint as solid blocks. Full class names, so Tailwind finds them.
 */

export type Tone = 'neutral' | 'muted' | 'accent' | 'info' | 'active' | 'good' | 'warn' | 'bad';

export const TONE: Record<Tone, { badge: string; ink: string; dot: string; bar: string; fill: string; wash: string; line: string }> = {
  neutral: {
    badge: 'bg-tone-neutral-fill text-tone-neutral-ink',
    ink: 'text-tone-neutral-ink',
    dot: 'bg-tone-neutral-solid',
    bar: 'bg-tone-neutral-solid',
    fill: 'bg-tone-neutral-fill',
    wash: 'bg-tone-neutral-fill dark:bg-tone-neutral-fill/40',
    line: 'border-tone-neutral-line',
  },
  muted: {
    badge: 'bg-transparent text-ink-tertiary shadow-[inset_0_0_0_1px_var(--line-subtle)]',
    ink: 'text-ink-tertiary',
    dot: 'bg-ink-disabled',
    bar: 'bg-neutral-secondary',
    fill: 'bg-neutral-subtle',
    wash: 'bg-neutral-subtle',
    line: 'border-line-subtle',
  },
  accent: {
    badge: 'bg-tone-accent-fill text-tone-accent-ink',
    ink: 'text-tone-accent-ink',
    dot: 'bg-tone-accent-solid',
    bar: 'bg-tone-accent-solid',
    fill: 'bg-tone-accent-fill',
    wash: 'bg-tone-accent-fill dark:bg-tone-accent-fill/40',
    line: 'border-tone-accent-line',
  },
  info: {
    badge: 'bg-tone-info-fill text-tone-info-ink',
    ink: 'text-tone-info-ink',
    dot: 'bg-tone-info-solid',
    bar: 'bg-tone-info-solid',
    fill: 'bg-tone-info-fill',
    wash: 'bg-tone-info-fill dark:bg-tone-info-fill/40',
    line: 'border-tone-info-line',
  },
  active: {
    badge: 'bg-tone-active-fill text-tone-active-ink',
    ink: 'text-tone-active-ink',
    dot: 'bg-tone-active-solid',
    bar: 'bg-tone-active-solid',
    fill: 'bg-tone-active-fill',
    wash: 'bg-tone-active-fill dark:bg-tone-active-fill/40',
    line: 'border-tone-active-line',
  },
  good: {
    badge: 'bg-tone-good-fill text-tone-good-ink',
    ink: 'text-tone-good-ink',
    dot: 'bg-tone-good-solid',
    bar: 'bg-tone-good-solid',
    fill: 'bg-tone-good-fill',
    wash: 'bg-tone-good-fill dark:bg-tone-good-fill/40',
    line: 'border-tone-good-line',
  },
  warn: {
    badge: 'bg-tone-warn-fill text-tone-warn-ink',
    ink: 'text-tone-warn-ink',
    dot: 'bg-tone-warn-solid',
    bar: 'bg-tone-warn-solid',
    fill: 'bg-tone-warn-fill',
    wash: 'bg-tone-warn-fill dark:bg-tone-warn-fill/40',
    line: 'border-tone-warn-line',
  },
  bad: {
    badge: 'bg-tone-bad-fill text-tone-bad-ink',
    ink: 'text-tone-bad-ink',
    dot: 'bg-tone-bad-solid',
    bar: 'bg-tone-bad-solid',
    fill: 'bg-tone-bad-fill',
    wash: 'bg-tone-bad-fill dark:bg-tone-bad-fill/40',
    line: 'border-tone-bad-line',
  },
};

export type Hue = 'neutral' | 'info' | 'active' | 'good' | 'pink' | 'orange' | 'lime' | 'yellow' | 'accent';

export const HUE: Record<Hue, { ink: string; fill: string }> = {
  neutral: { ink: 'text-tone-neutral-ink', fill: 'bg-tone-neutral-fill' },
  info: { ink: 'text-tone-info-ink', fill: 'bg-tone-info-fill' },
  active: { ink: 'text-tone-active-ink', fill: 'bg-tone-active-fill' },
  good: { ink: 'text-tone-good-ink', fill: 'bg-tone-good-fill' },
  pink: { ink: 'text-tone-pink-ink', fill: 'bg-tone-pink-fill' },
  orange: { ink: 'text-tone-orange-ink', fill: 'bg-tone-orange-fill' },
  lime: { ink: 'text-tone-lime-ink', fill: 'bg-tone-lime-fill' },
  yellow: { ink: 'text-tone-yellow-ink', fill: 'bg-tone-yellow-fill' },
  accent: { ink: 'text-tone-accent-ink', fill: 'bg-tone-accent-fill' },
};
