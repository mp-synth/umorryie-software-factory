import {
  ACCENTS,
  DARK_CANVASES,
  DENSITIES,
  NEUTRALS,
  RADII,
  TEXT_SIZES,
  TYPEFACES,
  type AccentName,
  type DarkCanvasName,
  type DensityName,
  type NeutralName,
  type RadiusName,
  type TextSizeName,
  type TypefaceName,
} from '@/design/tokens';
import { useSyncExternalStore } from 'react';
import { createStore, pick, record } from './store';
import { keysOf } from './utils';

const MODES = ['system', 'light', 'dark'] as const;
export type ModePreference = (typeof MODES)[number];
export type Mode = Exclude<ModePreference, 'system'>;

const SIDEBAR_STYLES = ['default', 'inverted'] as const;
export type SidebarStyle = (typeof SIDEBAR_STYLES)[number];

const MOTIONS = ['system', 'reduce', 'full'] as const;
export type Motion = (typeof MOTIONS)[number];

/** How much of an agent's work the live panel shows: its messages only, tool calls folded, or everything open. */
const ACTIVITY_DETAILS = ['summary', 'normal', 'verbose'] as const;
export type ActivityDetail = (typeof ACTIVITY_DETAILS)[number];

export interface Preferences {
  mode: ModePreference;
  accent: AccentName;
  neutral: NeutralName;
  darkCanvas: DarkCanvasName;
  density: DensityName;
  text: TextSizeName;
  radius: RadiusName;
  typeface: TypefaceName;
  sidebar: SidebarStyle;
  motion: Motion;
  agentColors: boolean;
  activityDetail: ActivityDetail;
  notifications: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  mode: 'system',
  accent: 'indigo',
  neutral: 'cool',
  darkCanvas: 'ink',
  density: 'default',
  text: 'md',
  radius: 'default',
  typeface: 'basier',
  sidebar: 'default',
  motion: 'system',
  agentColors: true,
  activityDetail: 'normal',
  notifications: false,
};

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** `legacyTheme` is the light/dark choice the UI stored before preferences existed. */
export function parsePreferences(stored: unknown, legacyTheme: string | null = null): Preferences {
  const p = record(stored);
  const d = DEFAULT_PREFERENCES;
  return {
    mode: pick(p.mode ?? legacyTheme, MODES, d.mode),
    accent: pick(p.accent, keysOf(ACCENTS), d.accent),
    neutral: pick(p.neutral, keysOf(NEUTRALS), d.neutral),
    darkCanvas: pick(p.darkCanvas, keysOf(DARK_CANVASES), d.darkCanvas),
    density: pick(p.density, keysOf(DENSITIES), d.density),
    text: pick(p.text, keysOf(TEXT_SIZES), d.text),
    radius: pick(p.radius, keysOf(RADII), d.radius),
    typeface: pick(p.typeface, keysOf(TYPEFACES), d.typeface),
    sidebar: pick(p.sidebar, SIDEBAR_STYLES, d.sidebar),
    motion: pick(p.motion, MOTIONS, d.motion),
    agentColors: bool(p.agentColors, d.agentColors),
    activityDetail: pick(p.activityDetail, ACTIVITY_DETAILS, d.activityDetail),
    notifications: bool(p.notifications, d.notifications),
  };
}

export const resolveMode = (preference: ModePreference, systemDark: boolean): Mode =>
  preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

/** The attributes on <html> that the token CSS reads. index.html sets the same ones before first paint. */
export function rootAttributes(p: Preferences, systemDark: boolean): Record<string, string> {
  return {
    mode: resolveMode(p.mode, systemDark),
    accent: p.accent,
    neutral: p.neutral,
    canvas: p.darkCanvas,
    density: p.density,
    text: p.text,
    radius: p.radius,
    typeface: p.typeface,
    motion: p.motion,
  };
}

const legacyTheme = () => {
  try {
    return localStorage.getItem('factory-theme');
  } catch {
    return null;
  }
};

export const preferences = createStore<Preferences>('factory-preferences', (stored) => parsePreferences(stored, stored ? null : legacyTheme()));
export const usePreferences = preferences.use;
export const setPreferences = (patch: Partial<Preferences>) => preferences.set(patch);

const systemDark = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');

function applyPreferences(): void {
  const attrs = rootAttributes(preferences.get(), !!systemDark?.matches);
  Object.assign(document.documentElement.dataset, attrs);
}

export function startPreferences(): void {
  applyPreferences();
  preferences.subscribe(applyPreferences);
  systemDark?.addEventListener('change', applyPreferences);
}

const subscribeSystem = (notify: () => void) => {
  systemDark?.addEventListener('change', notify);
  return () => systemDark?.removeEventListener('change', notify);
};

export function useResolvedMode(): Mode {
  const preference = usePreferences().mode;
  return resolveMode(preference, useSyncExternalStore(subscribeSystem, () => !!systemDark?.matches));
}
