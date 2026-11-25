import { useSyncExternalStore, type ReactNode } from 'react';

interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

type ConfirmRequest = ConfirmOptions & { resolve: (ok: boolean) => void };

/** Module state kept out of the dialog's module, so a hot reload of the dialog keeps pending requests. */
let request: ConfirmRequest | null = null;
const listeners = new Set<() => void>();
const setRequest = (next: ConfirmRequest | null) => {
  request = next;
  listeners.forEach((notify) => notify());
};

/** Asks before something that cannot be undone. Resolves true when the user confirms. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  request?.resolve(false);
  return new Promise((resolve) => setRequest({ ...options, resolve }));
}

export function useConfirmRequest(): { current: ConfirmRequest | null; close: (ok: boolean) => void } {
  const current = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => request,
  );
  const close = (ok: boolean) => {
    current?.resolve(ok);
    setRequest(null);
  };
  return { current, close };
}
