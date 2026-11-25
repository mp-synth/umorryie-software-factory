import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePreferences } from './preferences';
import { useInbox, useInitiatives } from './queries';

const APP = 'Software Factory';
const SVG_PREFIX = 'data:image/svg+xml,';
const DOT = "<circle cx='25' cy='7' r='6.5' fill='%23fdc218' stroke='%23090b22' stroke-width='2'/>";

/** index.html's icon with a warning dot on it: the browser tab shows that something waits on you. */
function setFaviconDot(on: boolean): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  link.dataset.base ??= link.href;
  const base = link.dataset.base;
  link.href = on && base.startsWith(SVG_PREFIX) ? base.replace('%3C/svg%3E', `${DOT.replace(/</g, '%3C').replace(/>/g, '%3E')}%3C/svg%3E`) : base;
}

export const notificationsSupported = () => typeof Notification !== 'undefined';

/**
 * Keeps the tab honest about what waits on you: a count in its title, a dot on its icon, and, when the
 * user turned them on, a system notification the moment an initiative starts waiting.
 */
export function useAttentionSignals(pageTitle: string): void {
  const navigate = useNavigate();
  const { notifications } = usePreferences();
  const { data: initiatives } = useInitiatives();
  const { items, total } = useInbox();
  const seen = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    document.title = `${total ? `(${total}) ` : ''}${pageTitle ? `${pageTitle} · ` : ''}${APP}`;
    setFaviconDot(total > 0);
  }, [total, pageTitle]);

  useEffect(() => {
    if (!initiatives) return;
    const now = new Map(items.map((i) => [i.initiative.id, i.initiative.attention ?? '']));
    const before = seen.current;
    seen.current = now;
    if (!before || !notifications || !notificationsSupported() || Notification.permission !== 'granted') return;
    for (const item of items) {
      const id = item.initiative.id;
      if (before.get(id) === now.get(id)) continue;
      const n = new Notification(item.title, { body: item.initiative.attention ?? item.detail, tag: id });
      n.onclick = () => {
        window.focus();
        navigate(item.to);
        n.close();
      };
    }
  }, [items, initiatives, notifications, navigate]);
}
