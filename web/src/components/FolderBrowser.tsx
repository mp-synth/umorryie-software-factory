import { useQuery } from '@tanstack/react-query';
import { ArrowUp, ChevronRight, Folder, FolderGit2, Home, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DirEntry } from '@factory/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button, IconButton, Spinner } from './ui';

function tildePath(p: string, home: string | undefined): string {
  return home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p;
}

export function FolderBrowser({
  start,
  mode,
  onPick,
  onClose,
}: {
  start?: string;
  mode: 'repository' | 'folder';
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [dir, setDir] = useState<string | undefined>(start);
  const [filter, setFilter] = useState('');
  const { data, error, isFetching } = useQuery({ queryKey: ['browse', dir ?? ''], queryFn: () => api.browse(dir), retry: false });
  useEffect(() => setFilter(''), [dir]);

  const entries = (data?.entries ?? []).filter((e) => e.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const picksOnClick = (e: DirEntry) => mode === 'repository' && e.git;
  const open = (e: DirEntry) => (picksOnClick(e) ? onPick(e.path) : setDir(e.path));
  const repoCount = (data?.entries ?? []).filter((e) => e.git).length;

  return (
    <div className="overflow-hidden rounded-lg border border-line-strong bg-black/25" data-testid="folder-browser">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <IconButton label="Parent folder" size="xs" disabled={!data?.parent} onClick={() => data?.parent && setDir(data.parent)}>
          <ArrowUp className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="Home folder" size="xs" onClick={() => data && setDir(data.home)}>
          <Home className="h-3.5 w-3.5" />
        </IconButton>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-zinc-400" title={data?.path}>
          {data ? tildePath(data.path, data.home) : '…'}
        </span>
        <div className="relative w-44">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
          <input
            autoFocus
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
            className="h-6 w-full rounded-md border border-line bg-black/30 pl-6 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-400/60 focus:outline-none"
          />
        </div>
        <IconButton label="Close folder browser" size="xs" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {isFetching && !data && (
          <li className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500">
            <Spinner /> Reading folder…
          </li>
        )}
        {error && <li className="px-3 py-2 text-xs text-rose-300">{(error as Error).message}</li>}
        {data && !entries.length && <li className="px-3 py-2 text-xs text-zinc-500">{filter ? 'No folder matches' : 'No subfolders'}</li>}
        {entries.map((e) => (
          <li key={e.path}>
            <div className="group flex items-center gap-2 px-2 hover:bg-white/[0.04]">
              <button type="button" onClick={() => open(e)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
                {e.git ? <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-violet-300" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
                <span className={cn('truncate text-[13px]', e.git ? 'text-zinc-100' : 'text-zinc-400')}>{e.name}</span>
                {e.git && <span className="rounded bg-violet-500/10 px-1.5 text-[10px] font-medium text-violet-300 ring-1 ring-inset ring-violet-400/20">git</span>}
              </button>
              {mode === 'folder' && (
                <Button size="xs" variant="ghost" className="opacity-0 group-hover:opacity-100" onClick={() => onPick(e.path)}>
                  Add
                </Button>
              )}
              {picksOnClick(e) ? (
                <span className="text-2xs text-zinc-500 opacity-0 group-hover:opacity-100">Select</span>
              ) : (
                <button type="button" aria-label={`Open ${e.name}`} onClick={() => setDir(e.path)} className="rounded p-0.5 text-zinc-600 hover:text-zinc-300">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-2xs text-zinc-500">
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
