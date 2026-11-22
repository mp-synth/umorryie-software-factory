import typography from '@tailwindcss/typography';
import colors from 'tailwindcss/colors';
import plugin from 'tailwindcss/plugin';

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const NEUTRALS = ['zinc'];
const HUES = ['violet', 'rose', 'amber', 'emerald', 'cyan', 'sky', 'fuchsia', 'indigo', 'teal', 'lime'];

const mirrored = (shade) => SHADES[SHADES.length - 1 - SHADES.indexOf(shade)];
const LIGHT_SHADE = {
  neutral: mirrored,
  hue: (shade) => (Number(shade) < 500 ? mirrored(shade) : shade),
};

const SURFACES = {
  bg: ['#09090c', '#f6f6f8'],
  surface: ['#101014', '#ffffff'],
  'surface-2': ['#15151b', '#f4f4f6'],
  'surface-3': ['#1b1b23', '#ebebef'],
  'surface-4': ['#23232d', '#e2e2e8'],
  sidebar: ['#0b0b0f', '#fbfbfc'],
  drawer: ['#0d0d11', '#fcfcfd'],
  popover: ['#17171e', '#ffffff'],
  tooltip: ['#1d1d26', '#ffffff'],
  line: ['#22222b', '#e4e4e9'],
  'line-strong': ['#30303c', '#d4d4dc'],
};

const SHADOW_PANEL = [
  '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 20px 40px -24px rgba(0,0,0,0.8)',
  '0 1px 2px 0 rgba(16,16,24,0.04), 0 12px 32px -20px rgba(16,16,24,0.18)',
];

const channels = (hex) => hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16)).join(' ');
const themed = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const palette = (name) => Object.fromEntries(SHADES.map((s) => [s, themed(`${name}-${s}`)]));

function themeVars(mode) {
  const light = mode === 'light';
  const vars = {};
  for (const [family, names] of [['neutral', NEUTRALS], ['hue', HUES]]) {
    for (const name of names) {
      for (const s of SHADES) vars[`--${name}-${s}`] = channels(colors[name][light ? LIGHT_SHADE[family](s) : s]);
    }
  }
  for (const [name, [dark, lightHex]] of Object.entries(SURFACES)) vars[`--${name}`] = channels(light ? lightHex : dark);
  vars['--white'] = light ? channels(colors.zinc[950]) : '255 255 255';
  vars['--black'] = light ? '255 255 255' : '0 0 0';
  vars['--shadow-panel'] = SHADOW_PANEL[light ? 1 : 0];
  vars.colorScheme = mode;
  return vars;
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ...Object.fromEntries([...NEUTRALS, ...HUES].map((name) => [name, palette(name)])),
        white: themed('white'),
        black: themed('black'),
        'on-accent': '#ffffff',
        bg: themed('bg'),
        surface: { DEFAULT: themed('surface'), 2: themed('surface-2'), 3: themed('surface-3'), 4: themed('surface-4') },
        sidebar: themed('sidebar'),
        drawer: themed('drawer'),
        popover: themed('popover'),
        tooltip: themed('tooltip'),
        line: { DEFAULT: themed('line'), strong: themed('line-strong') },
        accent: { DEFAULT: '#8b7cff', strong: '#7462ff', soft: 'rgba(139,124,255,0.14)' },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: { '2xs': ['0.6875rem', { lineHeight: '1rem' }] },
      boxShadow: {
        glow: '0 0 0 1px rgba(139,124,255,0.35), 0 8px 30px -8px rgba(139,124,255,0.45)',
        panel: 'var(--shadow-panel)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        'slide-in': { from: { transform: 'translateX(24px)', opacity: 0 }, to: { transform: 'none', opacity: 1 } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 rgba(34,211,238,0.5)' }, '100%': { boxShadow: '0 0 0 6px rgba(34,211,238,0)' } },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        'slide-in': 'slide-in 220ms cubic-bezier(0.16,1,0.3,1)',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-ring': 'pulse-ring 1.4s ease-out infinite',
      },
    },
  },
  plugins: [
    typography,
    plugin(({ addBase }) => addBase({ ':root': themeVars('dark'), ':root.light': themeVars('light') })),
  ],
};
