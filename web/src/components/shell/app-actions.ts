import { createContext, useContext } from 'react';
import type { Project } from '@factory/shared';

export interface AppActions {
  newInitiative: () => void;
  addProject: () => void;
  editProject: (project: Project) => void;
  openSearch: () => void;
  openShortcuts: () => void;
}

/**
 * Lives apart from its provider, whose dialogs change often: a hot reload that re-created the context
 * would leave every page reading a context that no provider fills.
 */
export const AppActionsContext = createContext<AppActions | null>(null);

export function useAppActions(): AppActions {
  const actions = useContext(AppActionsContext);
  if (!actions) throw new Error('useAppActions needs an AppActionsProvider');
  return actions;
}
