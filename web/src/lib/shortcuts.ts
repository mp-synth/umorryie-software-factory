import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toggleDock, toggleSidebar } from './layout';

export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export const GO_TO: Record<string, { path: string; label: string }> = {
  i: { path: '/inbox', label: 'Inbox' },
  o: { path: '/', label: 'Overview' },
  a: { path: '/agents', label: 'Agents' },
  p: { path: '/projects', label: 'Projects' },
  u: { path: '/usage', label: 'Usage' },
  s: { path: '/settings', label: 'Settings' },
};

export interface Shortcut {
  keys: string[];
  label: string;
  group: 'General' | 'Go to' | 'Layout' | 'Writing';
}

export const SHORTCUTS: Shortcut[] = [
  { keys: [MOD, 'K'], label: 'Search, jump to anything or run a command', group: 'General' },
  { keys: ['C'], label: 'New initiative', group: 'General' },
  { keys: ['?'], label: 'Show these shortcuts', group: 'General' },
  { keys: ['Esc'], label: 'Close a dialog, menu or the open run', group: 'General' },
  ...Object.entries(GO_TO).map(([key, { label }]): Shortcut => ({ keys: ['G', key.toUpperCase()], label, group: 'Go to' })),
  { keys: ['['], label: 'Collapse or expand the sidebar', group: 'Layout' },
  { keys: [']'], label: 'Show or hide the live agents panel', group: 'Layout' },
  { keys: [MOD, '↵'], label: 'Send a message, or save the open dialog', group: 'Writing' },
];

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const overlayOpen = () => !!document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]');

const G_TIMEOUT_MS = 1200;

export function useGlobalShortcuts({ palette, help, create }: { palette: () => void; help: () => void; create: () => void }): void {
  const navigate = useNavigate();
  const handlers = useRef({ palette, help, create });
  handlers.current = { palette, help, create };
  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handlers.current.palette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || overlayOpen()) return;
      const key = e.key.toLowerCase();
      const go = Date.now() - gAt < G_TIMEOUT_MS ? GO_TO[key] : undefined;
      gAt = 0;
      if (go) {
        e.preventDefault();
        navigate(go.path);
      } else if (key === 'g') {
        gAt = Date.now();
      } else if (e.key === '?') {
        e.preventDefault();
        handlers.current.help();
      } else if (key === 'c') {
        e.preventDefault();
        handlers.current.create();
      } else if (e.key === '[') {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === ']') {
        e.preventDefault();
        toggleDock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}
