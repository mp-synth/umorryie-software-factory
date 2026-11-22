import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'factory-theme';
const prefersLight = window.matchMedia('(prefers-color-scheme: light)');
const listeners = new Set<() => void>();

function storedPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function resolve(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference;
  return prefersLight.matches ? 'light' : 'dark';
}

let state = { preference: storedPreference(), theme: resolve(storedPreference()) };

function apply(preference: ThemePreference): void {
  state = { preference, theme: resolve(preference) };
  document.documentElement.classList.toggle('light', state.theme === 'light');
  document.documentElement.classList.toggle('dark', state.theme === 'dark');
  listeners.forEach((notify) => notify());
}

prefersLight.addEventListener('change', () => state.preference === 'system' && apply('system'));

export function setThemePreference(preference: ThemePreference): void {
  if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, preference);
  apply(preference);
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useTheme(): { preference: ThemePreference; theme: Theme } {
  return useSyncExternalStore(subscribe, () => state);
}
