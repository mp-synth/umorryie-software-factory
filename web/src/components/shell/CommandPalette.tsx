import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CornerDownLeft, FolderGit2, FolderPlus, Keyboard, Moon, PanelLeft, PanelRight, Palette, Plus, Search, Sun } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgentGlyph } from '@/components/AgentGlyph';
import { useRunDock } from '@/components/dock/use-run-dock';
import { InitiativeGlyph } from '@/components/StatusBadge';
import { Kbd } from '@/components/ui';
import { filterCommands } from '@/lib/commands';
import { toggleDock, toggleSidebar } from '@/lib/layout';
import { setPreferences, useResolvedMode } from '@/lib/preferences';
import { useActiveRuns, useInitiatives, useProjects } from '@/lib/queries';
import { GO_TO } from '@/lib/shortcuts';
import { initiativeStatus, isNotArchived, runKind } from '@/lib/status';
import { cn, shortPath } from '@/lib/utils';
import { NAV_ICONS } from './nav';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon: ReactNode;
  shortcut?: string[];
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onCreate,
  onAddProject,
  onHelp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: () => void;
  onAddProject: () => void;
  onHelp: () => void;
}) {
  const navigate = useNavigate();
  const dock = useRunDock();
  const mode = useResolvedMode();
  const { data: initiatives = [] } = useInitiatives();
  const { data: projects = [] } = useProjects();
  const { data: active = [] } = useActiveRuns();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(
    () => [
      ...initiatives
        .filter(isNotArchived)
        .map((i) => ({
          id: `initiative-${i.id}`,
          group: 'Initiatives',
          label: i.title,
          hint: i.attention ?? initiativeStatus[i.status].label,
          keywords: `${i.projectName} ${initiativeStatus[i.status].label}`,
          icon: <InitiativeGlyph initiative={i} />,
          run: () => navigate(`/i/${i.id}`),
        })),
      ...active.map((r) => ({
        id: `run-${r.id}`,
        group: 'Running agents',
        label: `${runKind[r.kind].agent} · ${r.ticketTitle ?? r.initiativeTitle ?? ''}`,
        hint: r.status === 'queued' ? 'waiting for a slot' : 'running',
        keywords: r.initiativeTitle ?? '',
        icon: <AgentGlyph kind={r.kind} size="sm" />,
        run: () => dock.watch(r.id),
      })),
      ...Object.entries(GO_TO).map(([key, go]) => {
        const Icon = NAV_ICONS[go.path];
        return { id: `go-${key}`, group: 'Go to', label: go.label, icon: <Icon />, shortcut: ['G', key.toUpperCase()], run: () => navigate(go.path) };
      }),
      { id: 'new', group: 'Actions', label: 'New initiative', keywords: 'create start plan feature', icon: <Plus />, shortcut: ['C'], run: onCreate },
      { id: 'add-project', group: 'Actions', label: 'Add a project', keywords: 'repository repo', icon: <FolderPlus />, run: onAddProject },
      {
        id: 'mode',
        group: 'Actions',
        label: mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        keywords: 'theme appearance dark light',
        icon: mode === 'dark' ? <Sun /> : <Moon />,
        run: () => setPreferences({ mode: mode === 'dark' ? 'light' : 'dark' }),
      },
      { id: 'appearance', group: 'Actions', label: 'Customize appearance', keywords: 'theme accent colour color density font text size radius', icon: <Palette />, run: () => navigate('/settings/appearance') },
      { id: 'sidebar', group: 'Actions', label: 'Collapse or expand the sidebar', icon: <PanelLeft />, shortcut: ['['], run: toggleSidebar },
      { id: 'dock', group: 'Actions', label: 'Show or hide the live agents panel', icon: <PanelRight />, shortcut: [']'], run: toggleDock },
      { id: 'help', group: 'Actions', label: 'Keyboard shortcuts', keywords: 'keys help', icon: <Keyboard />, shortcut: ['?'], run: onHelp },
      ...projects.map((p) => ({ id: `project-${p.id}`, group: 'Projects', label: p.name, hint: shortPath(p.repoPath), icon: <FolderGit2 />, run: () => navigate('/projects') })),
    ],
    [initiatives, active, projects, mode, navigate, dock, onCreate, onAddProject, onHelp],
  );

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const current = Math.min(index, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    c.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setIndex((current + step + results.length) % Math.max(1, results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[current]);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 flex animate-fade-in justify-center bg-overlay px-4 pt-[12vh] backdrop-blur-[2px]">
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onKeyDown={onKeyDown}
            className="flex h-fit max-h-[70vh] w-full max-w-[640px] animate-scale-in flex-col overflow-hidden rounded-2xl border border-line-subtle bg-raised shadow-dialog outline-none"
          >
            <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line-subtle px-4">
              <Search className="size-[18px] shrink-0 text-ink-tertiary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => (setQuery(e.target.value), setIndex(0))}
                placeholder="Search initiatives, agents, pages and commands…"
                aria-label="Search"
                className="h-full min-w-0 flex-1 bg-transparent text-md text-ink placeholder:text-ink-tertiary focus:outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>
            <div ref={list} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
              {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-ink-tertiary">Nothing matches “{query}”.</p>}
              {results.map((c, i) => (
                <div key={c.id}>
                  {(i === 0 || results[i - 1].group !== c.group) && <div className="eyebrow px-3 pb-1.5 pt-3 first:pt-1.5">{c.group}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === current}
                    data-index={i}
                    onMouseMove={() => i !== current && setIndex(i)}
                    onClick={() => run(c)}
                    className={cn('flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink [&_svg]:size-4', i === current && 'bg-hover')}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center text-ink-secondary">{c.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {c.hint && <span className="max-w-[40%] shrink-0 truncate text-xs text-ink-tertiary">{c.hint}</span>}
                    {c.shortcut && (
                      <span className="flex shrink-0 gap-1">
                        {c.shortcut.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-4 border-t border-line-subtle bg-sunken/60 px-4 py-2 text-xs text-ink-tertiary">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> to move
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>
                  <CornerDownLeft className="size-3" />
                </Kbd>
                to open
              </span>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
