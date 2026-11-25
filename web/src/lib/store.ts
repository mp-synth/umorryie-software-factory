import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get: () => T;
  set: (patch: Partial<T>, persist?: boolean) => void;
  reset: () => void;
  subscribe: (notify: () => void) => () => void;
  use: () => T;
}

/**
 * A value kept in localStorage and shared by every component that reads it. `parse` turns whatever
 * is stored (possibly from an older version, or hand-edited) into a valid value.
 */
export function createStore<T extends object>(key: string, parse: (stored: unknown) => T): Store<T> {
  const read = (): unknown => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  };
  let value = parse(read());
  const listeners = new Set<() => void>();
  const write = (next: T, persist: boolean) => {
    value = next;
    if (persist) {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage unavailable: the value holds for this tab only.
      }
    }
    listeners.forEach((notify) => notify());
  };
  const subscribe = (notify: () => void) => {
    listeners.add(notify);
    return () => listeners.delete(notify);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === key) write(parse(read()), false);
    });
  }
  return {
    get: () => value,
    set: (patch, persist = true) => write({ ...value, ...patch }, persist),
    reset: () => write(parse(null), true),
    subscribe,
    use: () => useSyncExternalStore(subscribe, () => value),
  };
}

export function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export const record = (stored: unknown): Record<string, unknown> => (stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {});
