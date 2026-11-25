/**
 * @fileoverview The factory's design tokens: TTVPlatform's Framework 26 ramps and semantic colour
 * roles, plus the appearance options a user can pick. Tailwind's config turns these into CSS custom
 * properties; the app imports the option lists for its appearance settings. Pure data, no DOM.
 */

export const STEPS = ['25', '50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
export type Step = (typeof STEPS)[number];
type Ramp = Record<Step, string>;

const ramp = (...hex: string[]): Ramp => Object.fromEntries(STEPS.map((s, i) => [s, hex[i]])) as Ramp;

/** Framework 26 System Constants (`token-pipeline/src/system/color.json`). */
export const SYSTEM_RAMPS = {
  blue: ramp('#f7f5fe', '#eeecfc', '#e6e3fb', '#cac5f6', '#aea9f1', '#8e8ded', '#6a72e8', '#3f5adc', '#3045af', '#213283', '#14205a'),
  lime: ramp('#e9fece', '#cffc99', '#acfb57', '#94df43', '#80c239', '#6da730', '#5b8c26', '#49721d', '#385915', '#28410e', '#1c2a09'),
  orange: ramp('#fff4f1', '#ffe9e3', '#ffded5', '#ffbba6', '#ff9474', '#ff653d', '#f42c00', '#c82300', '#9e1a00', '#741600', '#4a1300'),
  pink: ramp('#fcf4fb', '#fae9f6', '#f7def2', '#efbae6', '#e895db', '#e16ad2', '#c64fb8', '#a23f97', '#803076', '#5f2258', '#40143b'),
  teal: ramp('#e1fbff', '#c0f8ff', '#9bf3ff', '#00dff3', '#00c3d4', '#00a7b6', '#008c99', '#00727c', '#005961', '#004148', '#002b2f'),
  yellow: ramp('#fff5e6', '#ffecca', '#ffe2aa', '#fac300', '#daaa00', '#bb9200', '#9d7a00', '#806300', '#644d00', '#4a3800', '#312400'),
  grayscale: ramp('#f6f6f7', '#eeeeee', '#e5e5e6', '#cacacc', '#b0b0b3', '#97979a', '#7e7e83', '#66666a', '#505053', '#3a3a3c', '#262627'),
  bad: ramp('#fef4f3', '#fdeae6', '#fcdfda', '#f9bcb1', '#f79787', '#f46d5c', '#f1312f', '#c52725', '#9c1c1b', '#751311', '#4e0d07'),
  good: ramp('#e0feea', '#bbfdd4', '#8bfcbc', '#50e499', '#45c785', '#3aaa71', '#2f8f5e', '#25744c', '#1b5b3a', '#11432a', '#082c1a'),
  warn: ramp('#fff5e7', '#feebce', '#fee2b1', '#fdc218', '#dda914', '#be900f', '#9f790b', '#826207', '#664c04', '#4b3703', '#312402'),
} as const;
export type SystemRamp = keyof typeof SYSTEM_RAMPS;

/** The Synthesia theme's Parameters (`themes/synRoot/parameters/color.json`). */
export const SYNTHESIA_RAMPS = {
  accent: ramp('#f7f5fe', '#eeecfc', '#e6e3fb', '#cbc5f6', '#aea9f1', '#8f8ded', '#6c72e8', '#3f59de', '#3045b0', '#223284', '#14205b'),
  primary: ramp('#f6f6fc', '#ededf8', '#e4e4f5', '#c6c8eb', '#a8ade0', '#8993d6', '#6879cc', '#5162ad', '#3e4c88', '#2c3765', '#1c2445'),
  neutral: ramp('#f6f6f9', '#edeef2', '#e4e5ec', '#c8cad8', '#acb0c4', '#9196b1', '#767d9d', '#606680', '#4b4f64', '#363a4a', '#232531'),
} as const;

/** Lead colour of the Synthesia theme (`parameters.color.seed.primary`). */
const SEED_PRIMARY = '#090b22';

/** The theme ramps components alias: the accent, lead (primary) and neutral ramps. */
export type ThemeRamp = 'accent' | 'primary' | 'neutral';

/**
 * A semantic value: a step of a theme ramp, a system ramp step, the theme's lead colour or a swatch.
 * Written the way Framework 26's sources alias them, e.g. `accent.600` or `system.teal.200`.
 */
type Ref = `${ThemeRamp}.${Step}` | `system.${SystemRamp}.${Step}` | 'seed' | 'white' | 'black';

/** The four cells of a Framework 26 semantic colour: surface polarity × page mode. */
interface Cells {
  light: Ref;
  dark: Ref;
  invertedLight: Ref;
  invertedDark: Ref;
}

const cells = (light: Ref, dark: Ref, invertedLight: Ref, invertedDark: Ref): Cells => ({ light, dark, invertedLight, invertedDark });

/**
 * Framework 26 semantic colours (`themes/synRoot/sem/color.json`), named for the CSS variable each
 * becomes. `ink-good`, `ink-warn` and `ink-on-accent` are the factory's own: Framework has no
 * success or warning ink yet, and no accent-filled control.
 */
export const SEMANTIC_COLORS: Record<string, Cells> = {
  canvas: cells('white', 'black', 'seed', 'primary.100'),
  surface: cells('white', 'black', 'seed', 'primary.100'),

  'fill-primary': cells('seed', 'white', 'white', 'seed'),
  'fill-accent': cells('accent.600', 'accent.200', 'accent.200', 'accent.600'),
  'fill-accent-subtle': cells('accent.100', 'accent.800', 'accent.800', 'accent.200'),
  'fill-bad': cells('system.bad.600', 'system.bad.200', 'system.bad.200', 'system.bad.600'),
  'fill-bad-subtle': cells('system.bad.50', 'system.bad.800', 'system.bad.800', 'system.bad.200'),
  'fill-good-subtle': cells('system.good.25', 'system.good.800', 'system.good.800', 'system.good.200'),
  'fill-warn-subtle': cells('system.warn.25', 'system.warn.800', 'system.warn.800', 'system.warn.200'),
  'fill-neutral': cells('neutral.500', 'neutral.500', 'neutral.500', 'neutral.500'),
  'fill-neutral-secondary': cells('neutral.300', 'neutral.700', 'neutral.700', 'neutral.400'),
  'fill-neutral-subtle': cells('neutral.50', 'neutral.800', 'neutral.700', 'neutral.200'),

  ink: cells('seed', 'white', 'white', 'seed'),
  'ink-secondary': cells('neutral.600', 'neutral.300', 'neutral.300', 'neutral.600'),
  'ink-tertiary': cells('neutral.500', 'neutral.500', 'neutral.400', 'neutral.500'),
  'ink-accent': cells('accent.600', 'accent.200', 'accent.200', 'accent.800'),
  'ink-alert': cells('system.teal.600', 'system.teal.200', 'system.teal.200', 'system.teal.800'),
  'ink-bad': cells('system.bad.600', 'system.bad.200', 'system.bad.200', 'system.bad.800'),
  'ink-good': cells('system.good.600', 'system.good.200', 'system.good.200', 'system.good.700'),
  'ink-warn': cells('system.warn.600', 'system.warn.200', 'system.warn.200', 'system.warn.700'),
  'ink-on-primary': cells('white', 'seed', 'seed', 'white'),
  'ink-on-accent': cells('white', 'seed', 'seed', 'white'),
  'ink-on-bad': cells('white', 'system.bad.900', 'system.bad.900', 'white'),

  'line-primary': cells('seed', 'white', 'white', 'seed'),
  'line-strong': cells('neutral.500', 'neutral.400', 'neutral.400', 'neutral.500'),
  line: cells('neutral.200', 'neutral.700', 'neutral.600', 'neutral.300'),
  'line-accent': cells('accent.600', 'accent.300', 'accent.300', 'accent.600'),
  'line-focus': cells('accent.700', 'accent.300', 'accent.300', 'accent.700'),
  'line-bad': cells('system.bad.600', 'system.bad.200', 'system.bad.200', 'system.bad.800'),

  'hover-primary': cells('primary.900', 'primary.25', 'primary.25', 'primary.900'),
  'pressed-primary': cells('primary.800', 'primary.50', 'primary.50', 'primary.800'),
  'hover-primary-subtle': cells('primary.50', 'primary.800', 'primary.700', 'primary.200'),
  'pressed-primary-subtle': cells('primary.100', 'primary.700', 'primary.600', 'primary.300'),
  'hover-bad': cells('system.bad.700', 'system.bad.100', 'system.bad.100', 'system.bad.700'),
  'pressed-bad': cells('system.bad.800', 'system.bad.50', 'system.bad.50', 'system.bad.800'),
  'hover-bad-subtle': cells('system.bad.50', 'system.bad.800', 'system.bad.800', 'system.bad.200'),
  'pressed-bad-subtle': cells('system.bad.100', 'system.bad.700', 'system.bad.700', 'system.bad.300'),
  'hover-accent-line': cells('accent.300', 'accent.600', 'accent.600', 'accent.300'),
  'disabled-fill': cells('neutral.50', 'neutral.800', 'neutral.700', 'neutral.200'),
  'disabled-line': cells('neutral.200', 'neutral.700', 'neutral.600', 'neutral.300'),
  'disabled-ink': cells('neutral.400', 'neutral.500', 'neutral.400', 'neutral.500'),

  'focus-ring': cells('accent.700', 'accent.300', 'accent.300', 'accent.700'),
  'focus-offset': cells('white', 'black', 'seed', 'primary.100'),
  'scroll-thumb': cells('neutral.300', 'neutral.700', 'neutral.700', 'neutral.400'),
  'scroll-thumb-hover': cells('neutral.600', 'neutral.400', 'neutral.400', 'neutral.600'),
};

export type ToneStrength = 'ink' | 'fill' | 'solid' | 'line';
type ToneSteps = Record<ToneStrength, { light: Step; dark: Step }>;

/**
 * Each tone is a ramp read at four strengths: `ink` for text and icons, `fill` for a pale
 * background, `solid` for dots and bars, `line` for rings. The defaults follow Framework's pattern
 * (600 and pale steps on light pages, 200 and 800 on dark ones); a tone overrides a step where
 * Framework's own semantic colour reads it differently or the ramp's pale end is too loud.
 */
const TONE_STEPS: ToneSteps = {
  ink: { light: '600', dark: '200' },
  fill: { light: '25', dark: '800' },
  solid: { light: '500', dark: '300' },
  line: { light: '200', dark: '700' },
};

type Tone = { ramp: ThemeRamp | `system.${SystemRamp}`; steps?: { [K in ToneStrength]?: Partial<ToneSteps[K]> } };

export const TONES = {
  neutral: { ramp: 'neutral', steps: { ink: { dark: '300' }, fill: { light: '50' }, solid: { light: '400', dark: '500' } } },
  accent: { ramp: 'accent', steps: { fill: { light: '100' } } },
  info: { ramp: 'system.blue', steps: { fill: { light: '50' } } },
  active: { ramp: 'system.teal' },
  good: { ramp: 'system.good', steps: { solid: { light: '400' } } },
  warn: { ramp: 'system.warn', steps: { solid: { light: '300', dark: '200' } } },
  bad: { ramp: 'system.bad', steps: { fill: { light: '50' } } },
  pink: { ramp: 'system.pink', steps: { fill: { light: '50' } } },
  orange: { ramp: 'system.orange', steps: { fill: { light: '50' } } },
  lime: { ramp: 'system.lime' },
  yellow: { ramp: 'system.yellow', steps: { solid: { light: '300', dark: '200' } } },
} as const satisfies Record<string, Tone>;
export type ToneName = keyof typeof TONES;

export function toneStep(tone: ToneName, strength: ToneStrength, mode: 'light' | 'dark'): Step {
  const { steps } = TONES[tone] as Tone;
  return steps?.[strength]?.[mode] ?? TONE_STEPS[strength][mode];
}

/** Accent choices: the Synthesia accent or a Framework system ramp, the way a customer theme swaps it. */
export const ACCENTS = {
  indigo: { label: 'Indigo', ramp: null },
  teal: { label: 'Teal', ramp: 'teal' },
  pink: { label: 'Pink', ramp: 'pink' },
  orange: { label: 'Orange', ramp: 'orange' },
  lime: { label: 'Lime', ramp: 'lime' },
  gold: { label: 'Gold', ramp: 'yellow' },
  green: { label: 'Green', ramp: 'good' },
  graphite: { label: 'Graphite', ramp: 'grayscale' },
} as const satisfies Record<string, { label: string; ramp: SystemRamp | null }>;
export type AccentName = keyof typeof ACCENTS;

/**
 * Neutral choices. `cool` is Framework 26's navy-tinted neutral and lead colour; `graphite` is the
 * pure grey of the earlier design system, with its #101010 ink.
 */
export const NEUTRALS = {
  cool: { label: 'Cool', ramp: null, seed: SEED_PRIMARY, ink: '#0a0a12' },
  graphite: { label: 'Graphite', ramp: 'grayscale', seed: '#101010', ink: '#0b0b0c' },
} as const satisfies Record<string, { label: string; ramp: SystemRamp | null; seed: string; ink: string }>;
export type NeutralName = keyof typeof NEUTRALS;

/** Dark-page backgrounds: Synthesia's ink (the earlier design system's dark base) or Framework 26's black canvas. */
export const DARK_CANVASES = {
  ink: { label: 'Ink' },
  black: { label: 'Black' },
} as const;
export type DarkCanvasName = keyof typeof DARK_CANVASES;

/** Framework 26 brand-root density modifiers. */
export const DENSITIES = {
  compact: { label: 'Compact', modifier: 0.8 },
  default: { label: 'Default', modifier: 1 },
  comfortable: { label: 'Comfortable', modifier: 1.2 },
} as const;
export type DensityName = keyof typeof DENSITIES;

/** Root font sizes: every type step and control scales from it, like Framework's `baseFontSize`. */
export const TEXT_SIZES = {
  sm: { label: 'Small', px: 13 },
  md: { label: 'Default', px: 14 },
  lg: { label: 'Large', px: 15 },
  xl: { label: 'Larger', px: 16 },
} as const;
export type TextSizeName = keyof typeof TEXT_SIZES;

/** Base corner radius. Framework's buttons use 8px; the other steps of the scale derive from it. */
export const RADII = {
  sharp: { label: 'Sharp', px: 4 },
  default: { label: 'Default', px: 8 },
  round: { label: 'Round', px: 12 },
} as const;
export type RadiusName = keyof typeof RADII;

export const TYPEFACES = {
  basier: { label: 'Basier Square', sans: '"Basier Square"', mono: '"Basier Square Mono"', heading: '-0.04em' },
  inter: { label: 'Inter', sans: '"Inter Variable", "Inter"', mono: '"JetBrains Mono Variable"', heading: '-0.02em' },
  system: { label: 'System', sans: '-apple-system, BlinkMacSystemFont', mono: 'ui-monospace, SFMono-Regular', heading: '-0.015em' },
} as const;
export type TypefaceName = keyof typeof TYPEFACES;

/** Framework 26 `typography.fallback`. */
export const FALLBACK_SANS = 'system-ui, "Segoe WP", "Segoe UI", Roboto, Ubuntu, "Helvetica Neue", Arial, sans-serif';
export const FALLBACK_MONO = '"Roboto Mono", Monaco, "Courier New", monospace';
