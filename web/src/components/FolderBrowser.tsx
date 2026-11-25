import { useQuery } from '@tanstack/react-query';
import { ArrowUp, ChevronRight, Folder, FolderGit2, Home, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DirEntry } from '@factory/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge, Button, IconButton, Spinner } from './ui';

function tildePath(p: string, home: string | undefined): string {
  return home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p;
}

export function FolderBrowser({ start, mode, onPick, onClose }: { start?: string; mode: 'repository' | 'folder'; onPick: (path: string) => void; onClose: () => void }) {
  const [dir, setDir] = useState<string | undefined>(start);
  const [filter, setFilter] = useState('');
  const { data, error, isFetching } = useQuery({ queryKey: ['browse', dir ?? ''], queryFn: () => api.browse(dir), retry: false });
  useEffect(() => setFilter(''), [dir]);

  const entries = (data?.entries ?? []).filter((e) => e.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const picksOnClick = (e: DirEntry) => mode === 'repository' && e.git;
  const open = (e: DirEntry) => (picksOnClick(e) ? onPick(e.path) : setDir(e.path));
  const repoCount = (data?.entries ?? []).filter((e) => e.git).length;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-sunken" data-testid="folder-browser">
      <div className="flex items-center gap-1 border-b border-line-subtle px-1.5 py-1.5">
        <IconButton label="Parent folder" size="xs" icon={<ArrowUp />} disabled={!data?.parent} onClick={() => data?.parent && setDir(data.parent)} />
        <IconButton label="Home folder" size="xs" icon={<Home />} onClick={() => data && setDir(data.home)} />
        <span className="min-w-0 flex-1 truncate px-1 font-mono text-xs text-ink-secondary" title={data?.path}>
          {data ? tildePath(data.path, data.home) : '…'}
        </span>
        <div className="relative w-44">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-tertiary" />
          <input
            autoFocus
            data-autofocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && entries[0]) {
                e.preventDefault();
                open(entries[0]);
              }
            }}
            placeholder="Filter"
            aria-label="Filter folders"
            className="h-control-xs w-full rounded-md border border-line bg-panel pl-7 pr-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-line-focus focus:outline-none"
          />
        </div>
        <IconButton label="Close folder browser" size="xs" icon={<X />} onClick={onClose} />
      </div>
      <ul className="max-h-64 overflow-y-auto p-1">
        {isFetching && !data && (
          <li className="flex items-center gap-2 px-2 py-2 text-sm text-ink-secondary">
            <Spinner /> Reading the folder…
          </li>
        )}
        {error && <li className="px-2 py-2 text-sm text-ink-bad">{(error as Error).message}</li>}
        {data && !entries.length && <li className="px-2 py-2 text-sm text-ink-tertiary">{filter ? 'No folder matches' : 'No subfolders'}</li>}
        {entries.map((e) => (
          <li key={e.path}>
            <div className="group flex items-center gap-2 rounded-md px-1.5 hover:bg-hover">
              <button type="button" onClick={() => open(e)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
                {e.git ? <FolderGit2 className="size-4 shrink-0 text-ink-accent" /> : <Folder className="size-4 shrink-0 text-ink-tertiary" />}
                <span className={cn('truncate text-sm', e.git ? 'text-ink' : 'text-ink-secondary')}>{e.name}</span>
                {e.git && <Badge tone="accent">git</Badge>}
              </button>
              {mode === 'folder' && (
                <Button size="xs" variant="ghost" className="opacity-0 group-hover:opacity-100" onClick={() => onPick(e.path)}>
                  Add
                </Button>
              )}
              {picksOnClick(e) ? (
                <span className="text-xs text-ink-tertiary opacity-0 group-hover:opacity-100">Select</span>
              ) : (
                <button type="button" aria-label={`Open ${e.name}`} onClick={() => setDir(e.path)} className="rounded-sm p-0.5 text-ink-tertiary hover:text-ink">
                  <ChevronRight className="size-4" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-line-subtle px-3 py-1.5 text-xs text-ink-tertiary">
        <span className="flex-1">
          {mode === 'repository'
            ? `${repoCount} git repositor${repoCount === 1 ? 'y' : 'ies'} here · click one to select it, or a folder to open it`
            : 'Open a folder, then add it or any folder listed'}
        </span>
        {mode === 'folder' && data && (
          <Button size="xs" variant="outline" onClick={() => onPick(data.path)}>
            Add this folder
          </Button>
        )}
      </div>
    </div>
  );
}
