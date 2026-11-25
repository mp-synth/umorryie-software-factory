import typography from '@tailwindcss/typography';
import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import {
  ACCENTS,
  DENSITIES,
  FALLBACK_MONO,
  FALLBACK_SANS,
  NEUTRALS,
  RADII,
  SEMANTIC_COLORS,
  STEPS,
  SYNTHESIA_RAMPS,
  SYSTEM_RAMPS,
  TEXT_SIZES,
  TONES,
  TYPEFACES,
  toneStep,
  type ToneName,
  type ToneStrength,
} from './src/design/tokens';

type Vars = Record<string, string>;
type Mode = 'light' | 'dark';
type Scope = { mode: Mode; inverted: boolean };

const rampVars = (name: string, ramp: Record<string, string>): Vars => Object.fromEntries(STEPS.map((s) => [`--fw-${name}-${s}`, ramp[s]]));
const aliasRamp = (name: string, to: string): Vars => Object.fromEntries(STEPS.map((s) => [`--fw-${name}-${s}`, `var(--fw-${to}-${s})`]));

function ref(value: string): string {
  if (value === 'white') return '#ffffff';
  if (value === 'black') return '#000000';
  if (value === 'seed') return 'var(--fw-seed)';
  const [first, ...rest] = value.split('.');
  return first === 'system' ? `var(--fw-${rest[0]}-${rest[1]})` : `var(--fw-${first}-${rest[0]})`;
}

const cell = ({ mode, inverted }: Scope) => (inverted ? (mode === 'light' ? 'invertedLight' : 'invertedDark') : mode);
/** The mode whose steps a surface reads: an inverted surface on a light page looks dark, and the reverse. */
const looks = ({ mode, inverted }: Scope): Mode => (inverted ? (mode === 'light' ? 'dark' : 'light') : mode);

function semanticVars(scope: Scope): Vars {
  const vars: Vars = {};
  for (const [name, cells] of Object.entries(SEMANTIC_COLORS)) vars[`--${name}`] = ref(cells[cell(scope)]);
  return vars;
}

const STRENGTHS: ToneStrength[] = ['ink', 'fill', 'solid', 'line'];

function toneVars(scope: Scope): Vars {
  const vars: Vars = {};
  for (const [tone, { ramp }] of Object.entries(TONES)) {
    for (const strength of STRENGTHS) {
      const step = toneStep(tone as ToneName, strength, looks(scope));
      vars[`--tone-${tone}-${strength}`] = ref(`${ramp}.${step}`);
    }
  }
  return vars;
}

const mix = (color: string, pct: number, over = 'transparent') => `color-mix(in srgb, ${color} ${pct}%, ${over})`;

/** The factory's chrome, composed from Framework roles: the window backdrop, panels, popovers, wells and hover washes. */
function appVars(scope: Scope): Vars {
  const dark = looks(scope) === 'dark';
  const shadow = dark ? '0 0 0' : '9 11 34';
  const page = !scope.inverted;
  return {
    '--app-backdrop': page && !dark ? 'var(--fw-neutral-25)' : 'var(--canvas)',
    '--app-panel': page && dark ? mix('var(--fw-neutral-900)', 26, 'var(--canvas)') : 'var(--canvas)',
    '--app-raised': page && dark ? mix('var(--fw-neutral-900)', 58, 'var(--canvas)') : 'var(--surface)',
    '--app-sunken': dark ? mix('#000000', 32, 'var(--app-panel)') : mix('var(--fw-neutral-50)', 55, 'var(--app-panel)'),
    '--line-subtle': dark ? mix(scope.inverted ? 'var(--fw-neutral-600)' : 'var(--fw-neutral-700)', 62) : scope.inverted ? 'var(--fw-neutral-300)' : 'var(--fw-neutral-100)',
    '--fill-neutral-subtle-hover': mix('var(--ink)', dark ? 8 : 6, 'var(--fill-neutral-subtle)'),
    '--fill-neutral-subtle-pressed': mix('var(--ink)', dark ? 13 : 11, 'var(--fill-neutral-subtle)'),
    '--app-hover': mix('var(--ink)', dark ? 6 : 5),
    '--app-pressed': mix('var(--ink)', dark ? 10 : 9),
    '--app-selected': mix('var(--ink)', dark ? 9 : 7),
    '--app-overlay': dark ? 'rgb(0 0 0 / 0.62)' : 'rgb(9 11 34 / 0.38)',
    '--shadow-xs': `0 1px 2px 0 rgb(${shadow} / ${dark ? 0.4 : 0.05})`,
    '--shadow-sm': `0 1px 3px 0 rgb(${shadow} / ${dark ? 0.45 : 0.07}), 0 1px 2px -1px rgb(${shadow} / ${dark ? 0.35 : 0.05})`,
    '--shadow-popover': `0 16px 36px -8px rgb(${shadow} / ${dark ? 0.6 : 0.16}), 0 3px 8px -2px rgb(${shadow} / ${dark ? 0.4 : 0.06})`,
    '--shadow-dialog': `0 28px 72px -12px rgb(${shadow} / ${dark ? 0.7 : 0.3}), 0 4px 12px -4px rgb(${shadow} / ${dark ? 0.4 : 0.08})`,
    colorScheme: looks(scope),
  };
}

const scopeVars = (scope: Scope): Vars => ({ ...semanticVars(scope), ...toneVars(scope), ...appVars(scope) });

const typeface = (t: (typeof TYPEFACES)[keyof typeof TYPEFACES]): Vars => ({
  '--font-sans': `${t.sans}, "Inter Variable", ${FALLBACK_SANS}`,
  '--font-mono': `${t.mono}, "JetBrains Mono Variable", ${FALLBACK_MONO}`,
  '--heading-tracking': t.heading,
});

function appearanceRules(): Record<string, Vars> {
  const rules: Record<string, Vars> = {};
  for (const [name, accent] of Object.entries(ACCENTS)) if (accent.ramp) rules[`:root[data-accent="${name}"]`] = aliasRamp('accent', accent.ramp);
  for (const [name, neutral] of Object.entries(NEUTRALS)) {
    if (!neutral.ramp) continue;
    rules[`:root[data-neutral="${name}"]`] = {
      ...aliasRamp('neutral', neutral.ramp),
      ...aliasRamp('primary', neutral.ramp),
      '--fw-seed': neutral.seed,
      '--fw-dark-ink': neutral.ink,
    };
  }
  for (const [name, d] of Object.entries(DENSITIES)) rules[`:root[data-density="${name}"]`] = { '--density': String(d.modifier) };
  for (const [name, t] of Object.entries(TEXT_SIZES)) rules[`:root[data-text="${name}"]`] = { fontSize: `${(t.px / 16) * 100}%` };
  for (const [name, r] of Object.entries(RADII)) rules[`:root[data-radius="${name}"]`] = { '--radius': `${r.px}px` };
  for (const [name, t] of Object.entries(TYPEFACES)) rules[`:root[data-typeface="${name}"]`] = typeface(t);
  return rules;
}

const darkCanvas = (color: string): Vars => ({ '--canvas': color, '--surface': color, '--focus-offset': color });

const tokens = plugin(({ addBase }) => {
  const light: Scope = { mode: 'light', inverted: false };
  const dark: Scope = { mode: 'dark', inverted: false };
  addBase({
    ':root': {
      ...Object.assign({}, ...Object.entries(SYSTEM_RAMPS).map(([name, r]) => rampVars(name, r))),
      ...rampVars('accent', SYNTHESIA_RAMPS.accent),
      ...rampVars('primary', SYNTHESIA_RAMPS.primary),
      ...rampVars('neutral', SYNTHESIA_RAMPS.neutral),
      '--fw-seed': NEUTRALS.cool.seed,
      '--fw-dark-ink': NEUTRALS.cool.ink,
      '--density': '1',
      '--density-control': 'calc(0.5 + var(--density) / 2)',
      '--radius': `${RADII.default.px}px`,
      '--focus-ring-width': '4px',
      '--focus-offset-width': '2px',
      '--font-numeric': '"Inter Numerals", var(--font-sans)',
      fontSize: `${(TEXT_SIZES.md.px / 16) * 100}%`,
      ...typeface(TYPEFACES.basier),
      ...scopeVars(light),
    },
    ':root[data-mode="dark"]': { ...scopeVars(dark), ...darkCanvas('var(--fw-dark-ink)') },
    ':root[data-mode="dark"][data-canvas="black"]': darkCanvas('#000000'),
    ':root:not([data-mode="dark"]) [data-surface="inverted"]': scopeVars({ mode: 'light', inverted: true }),
    ':root[data-mode="dark"] [data-surface="inverted"]': scopeVars({ mode: 'dark', inverted: true }),
    ...appearanceRules(),
  });
});

/** Pages lay out by the width of the main panel, not the window: the sidebar and the live panel take their share. */
const PANEL_SCREENS = { sm: 560, md: 720, lg: 920, xl: 1140, '2xl': 1400 };
const containerVariants = plugin(({ addVariant }) => {
  for (const [name, px] of Object.entries(PANEL_SCREENS)) addVariant(`@${name}`, `@container page (min-width: ${px}px)`);
});

const token = (name: string) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;
const tones = Object.fromEntries(Object.keys(TONES).map((t) => [t, Object.fromEntries(STRENGTHS.map((s) => [s, token(`tone-${t}-${s}`)]))]));

const SPACE: Record<string, number> = {
  0.5: 0.125, 1: 0.25, 1.5: 0.375, 2: 0.5, 2.5: 0.625, 3: 0.75, 3.5: 0.875, 4: 1, 4.5: 1.125, 5: 1.25, 6: 1.5, 7: 1.75, 8: 2,
  9: 2.25, 10: 2.5, 11: 2.75, 12: 3, 14: 3.5, 16: 4, 20: 5, 24: 6, 28: 7, 32: 8,
};
/** Whitespace follows the density modifier; widths, heights and icons do not. */
const densitySpace = { 0: '0px', px: '1px', ...Object.fromEntries(Object.entries(SPACE).map(([k, rem]) => [k, `calc(${rem}rem * var(--density))`])) };
const control = (rem: number) => `calc(${rem}rem * var(--density-control))`;
const radius = (factor: number) => `calc(var(--radius) * ${factor})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-mode="dark"]'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      white: '#ffffff',
      black: '#000000',
      canvas: token('canvas'),
      backdrop: token('app-backdrop'),
      panel: token('app-panel'),
      raised: token('app-raised'),
      sunken: token('app-sunken'),
      hover: 'var(--app-hover)',
      pressed: 'var(--app-pressed)',
      selected: 'var(--app-selected)',
      overlay: 'var(--app-overlay)',
      ink: {
        DEFAULT: token('ink'),
        secondary: token('ink-secondary'),
        tertiary: token('ink-tertiary'),
        disabled: token('disabled-ink'),
        accent: token('ink-accent'),
        alert: token('ink-alert'),
        bad: token('ink-bad'),
        good: token('ink-good'),
        warn: token('ink-warn'),
        'on-primary': token('ink-on-primary'),
        'on-accent': token('ink-on-accent'),
        'on-bad': token('ink-on-bad'),
      },
      primary: {
        DEFAULT: token('fill-primary'),
        hover: token('hover-primary'),
        pressed: token('pressed-primary'),
        'subtle-hover': token('hover-primary-subtle'),
        'subtle-pressed': token('pressed-primary-subtle'),
      },
      accent: { DEFAULT: token('fill-accent'), subtle: token('fill-accent-subtle') },
      bad: {
        DEFAULT: token('fill-bad'),
        subtle: token('fill-bad-subtle'),
        hover: token('hover-bad'),
        pressed: token('pressed-bad'),
        'subtle-hover': token('hover-bad-subtle'),
        'subtle-pressed': token('pressed-bad-subtle'),
      },
      good: { subtle: token('fill-good-subtle') },
      warn: { subtle: token('fill-warn-subtle') },
      neutral: {
        DEFAULT: token('fill-neutral'),
        secondary: token('fill-neutral-secondary'),
        subtle: token('fill-neutral-subtle'),
        'subtle-hover': token('fill-neutral-subtle-hover'),
        'subtle-pressed': token('fill-neutral-subtle-pressed'),
      },
      disabled: { DEFAULT: token('disabled-fill'), line: token('disabled-line') },
      line: {
        DEFAULT: token('line'),
        subtle: token('line-subtle'),
        strong: token('line-strong'),
        primary: token('line-primary'),
        accent: token('line-accent'),
        'accent-hover': token('hover-accent-line'),
        focus: token('line-focus'),
        bad: token('line-bad'),
      },
      focus: { ring: token('focus-ring'), offset: token('focus-offset') },
      tone: tones,
    },
    fontFamily: {
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)',
      numeric: 'var(--font-numeric)',
    },
    fontSize: {
      '2xs': ['0.786rem', { lineHeight: '1.143rem' }],
      xs: ['0.857rem', { lineHeight: '1.143rem' }],
      sm: ['0.929rem', { lineHeight: '1.286rem' }],
      base: ['1rem', { lineHeight: '1.429rem' }],
      md: ['1.071rem', { lineHeight: '1.571rem' }],
      lg: ['1.143rem', { lineHeight: '1.714rem' }],
      xl: ['1.286rem', { lineHeight: '1.714rem' }],
      '2xl': ['1.714rem', { lineHeight: '2.286rem' }],
      '3xl': ['2.571rem', { lineHeight: '3rem' }],
    },
    borderRadius: {
      none: '0px',
      xs: radius(0.25),
      sm: radius(0.5),
      DEFAULT: radius(0.75),
      md: radius(0.75),
      lg: radius(1),
      xl: radius(1.5),
      '2xl': radius(2),
      '3xl': radius(3),
      full: '9999px',
    },
    boxShadow: {
      none: 'none',
      xs: 'var(--shadow-xs)',
      sm: 'var(--shadow-sm)',
      popover: 'var(--shadow-popover)',
      dialog: 'var(--shadow-dialog)',
    },
    extend: {
      padding: densitySpace,
      margin: densitySpace,
      gap: densitySpace,
      space: densitySpace,
      spacing: {
        'control-xs': control(1.571),
        'control-sm': control(1.857),
        'control-md': control(2.286),
        'control-lg': control(2.714),
      },
      letterSpacing: { heading: 'var(--heading-tracking)', label: '0.04em' },
      transitionTimingFunction: { framework: 'cubic-bezier(0, 0, 0.2, 1)', spring: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      transitionDuration: { quick: '80ms', hover: '200ms' },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(3px)' }, to: { opacity: '1', transform: 'none' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in-right': { from: { opacity: '0', transform: 'translateX(16px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        breathe: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
        ping: { '75%, 100%': { transform: 'scale(2.2)', opacity: '0' } },
        progress: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(250%)' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms cubic-bezier(0, 0, 0.2, 1)',
        'scale-in': 'scale-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s infinite',
        breathe: 'breathe 2s ease-in-out infinite',
        ping: 'ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite',
        progress: 'progress 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      },
    },
  },
  plugins: [typography, tokens, containerVariants],
} satisfies Config;
