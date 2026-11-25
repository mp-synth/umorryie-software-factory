import { createStore, record } from './store';

export interface Layout {
  sidebarCollapsed: boolean;
  /** Sidebar groups the user folded, such as Done. */
  foldedGroups: string[];
  dockOpen: boolean;
  dockWidth: number;
  initiativeView: 'cards' | 'list';
}

export const DOCK_MIN_WIDTH = 360;
export const DOCK_DEFAULT_WIDTH = 500;

/** Reads the panel prefs the live panel stored before the layout store existed. */
function legacyDock(): Partial<Layout> {
  try {
    const p = record(JSON.parse(localStorage.getItem('factory-run-dock') ?? 'null'));
    return { ...(typeof p.open === 'boolean' && { dockOpen: p.open }), ...(typeof p.width === 'number' && { dockWidth: p.width }) };
  } catch {
    return {};
  }
}

export function parseLayout(stored: unknown, legacy: Partial<Layout> = {}): Layout {
  const p = { ...legacy, ...record(stored) };
  return {
    sidebarCollapsed: p.sidebarCollapsed === true,
    foldedGroups: Array.isArray(p.foldedGroups) ? p.foldedGroups.filter((g): g is string => typeof g === 'string') : ['done'],
    dockOpen: p.dockOpen !== false,
    dockWidth: typeof p.dockWidth === 'number' && Number.isFinite(p.dockWidth) ? Math.max(DOCK_MIN_WIDTH, Math.round(p.dockWidth)) : DOCK_DEFAULT_WIDTH,
    initiativeView: p.initiativeView === 'list' ? 'list' : 'cards',
  };
}

export const layout = createStore<Layout>('factory-layout', (stored) => parseLayout(stored, stored ? {} : legacyDock()));
export const useLayout = layout.use;

export const toggleSidebar = () => layout.set({ sidebarCollapsed: !layout.get().sidebarCollapsed });
export const toggleDock = () => layout.set({ dockOpen: !layout.get().dockOpen });

export function toggleGroup(group: string): void {
  const folded = layout.get().foldedGroups;
  layout.set({ foldedGroups: folded.includes(group) ? folded.filter((g) => g !== group) : [...folded, group] });
}
