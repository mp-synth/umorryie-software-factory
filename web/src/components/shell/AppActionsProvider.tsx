import { useMemo, useState, type ReactNode } from 'react';
import type { Project } from '@factory/shared';
import { NewInitiativeDialog } from '@/components/NewInitiativeDialog';
import { ProjectDialog } from '@/components/ProjectDialog';
import { useGlobalShortcuts } from '@/lib/shortcuts';
import { AppActionsContext, type AppActions } from './app-actions';
import { CommandPalette } from './CommandPalette';
import { ShortcutsDialog } from './ShortcutsDialog';

/** The dialogs any page can open, and the keyboard shortcuts that open them. */
export function AppActionsProvider({ children }: { children: ReactNode }) {
  const [creating, setCreating] = useState(false);
  const [projectDialog, setProjectDialog] = useState<{ open: boolean; project: Project | null }>({ open: false, project: null });
  const [searching, setSearching] = useState(false);
  const [help, setHelp] = useState(false);
  const actions = useMemo<AppActions>(
    () => ({
      newInitiative: () => setCreating(true),
      addProject: () => setProjectDialog({ open: true, project: null }),
      editProject: (project) => setProjectDialog({ open: true, project }),
      openSearch: () => setSearching(true),
      openShortcuts: () => setHelp(true),
    }),
    [],
  );
  useGlobalShortcuts({ palette: actions.openSearch, help: actions.openShortcuts, create: actions.newInitiative });
  return (
    <AppActionsContext.Provider value={actions}>
      {children}
      <NewInitiativeDialog open={creating} onOpenChange={setCreating} onAddProject={actions.addProject} />
      <ProjectDialog open={projectDialog.open} project={projectDialog.project} onOpenChange={(open) => setProjectDialog((d) => ({ ...d, open }))} />
      <CommandPalette open={searching} onOpenChange={setSearching} onCreate={actions.newInitiative} onAddProject={actions.addProject} onHelp={actions.openShortcuts} />
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
    </AppActionsContext.Provider>
  );
}
