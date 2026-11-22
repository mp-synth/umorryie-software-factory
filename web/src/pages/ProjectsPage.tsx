import { toastError, toastSuccess } from '@/lib/toasts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BookOpen, FolderGit2, Github, GitBranch, KeyRound, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '@factory/shared';
import { api } from '@/lib/api';
import { isNotArchived } from '@/lib/status';
import { shortPath } from '@/lib/utils';
import { ProjectDialog } from '@/components/ProjectDialog';
import { Button, Card, Chip, EmptyState, Menu, MenuItem, Skeleton } from '@/components/ui';

export function ProjectsPage() {
  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const { data: initiatives = [] } = useQuery({ queryKey: ['initiatives'], queryFn: api.initiatives });
  const [dialog, setDialog] = useState<{ open: boolean; project: Project | null }>({ open: false, project: null });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: toastSuccess('Project removed'),
    onError: toastError,
  });

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Projects</h1>
          <p className="mt-1 text-sm text-zinc-500">Local repositories the factory can build in. The checks command is the gate every branch must pass.</p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({ open: true, project: null })}>
          Add project
        </Button>
      </header>
      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !projects?.length ? (
        <Card>
          <EmptyState
            icon={<FolderGit2 />}
            title="No projects yet"
            action={
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDialog({ open: true, project: null })}>
                Add your first repository
              </Button>
            }
          >
            Point the factory at a git checkout on this machine. It reads CLAUDE.md, detects branches and suggests a checks command.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map((p) => {
            const count = initiatives.filter((i) => i.projectId === p.id && isNotArchived(i)).length;
            return (
              <Card key={p.id} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-zinc-400">
                    <FolderGit2 className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-zinc-100">{p.name}</div>
                    <div className="truncate font-mono text-2xs text-zinc-500" title={p.repoPath}>
                      {shortPath(p.repoPath)}
                    </div>
                  </div>
                  <Menu trigger={<Button size="sm" variant="ghost" className="w-7 px-0" aria-label="Project actions"><MoreHorizontal className="h-4 w-4" /></Button>}>
                    <MenuItem icon={<Pencil />} onSelect={() => setDialog({ open: true, project: p })}>
                      Edit
                    </MenuItem>
                    <MenuItem
                      icon={<Trash2 />}
                      danger
                      onSelect={() => {
                        if (confirm(`Remove ${p.name} from the factory? The repository itself is not touched.`)) remove.mutate(p.id);
                      }}
                    >
                      Remove
                    </MenuItem>
                  </Menu>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Chip>
                    <GitBranch className="h-3 w-3" /> {p.defaultBranch}
                  </Chip>
                  {p.remoteUrl && /github\.com[:/]/.test(p.remoteUrl) ? (
                    <Chip title={p.remoteUrl}>
                      <Github className="h-3 w-3" /> {p.remoteUrl.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')}
                    </Chip>
                  ) : p.remoteUrl ? (
                    <Chip title={p.remoteUrl}>origin {shortPath(p.remoteUrl)} · no PRs</Chip>
                  ) : (
                    <Chip>local only · no PRs</Chip>
                  )}
                  <Chip>{count} initiative{count === 1 ? '' : 's'}</Chip>
                </div>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-teal-300/70" />
                    <dt className="w-14 shrink-0 text-zinc-500">Checks</dt>
                    <dd className="truncate font-mono text-2xs text-zinc-300">{p.checksCommand ?? <span className="text-amber-300/80">none — the gate is skipped</span>}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <Wrench className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    <dt className="w-14 shrink-0 text-zinc-500">Setup</dt>
                    <dd className="truncate font-mono text-2xs text-zinc-300">{p.setupCommand ?? '—'}</dd>
                  </div>
                  {p.copyFiles.length > 0 && (
                    <div className="flex items-center gap-2">
                      <KeyRound className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      <dt className="w-14 shrink-0 text-zinc-500">Copies</dt>
                      <dd className="truncate font-mono text-2xs text-zinc-300">{p.copyFiles.join(', ')}</dd>
                    </div>
                  )}
                  {p.referenceDirs.length > 0 && (
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      <dt className="w-14 shrink-0 text-zinc-500">Reads</dt>
                      <dd className="truncate font-mono text-2xs text-zinc-300" title={p.referenceDirs.join('\n')}>
                        {p.referenceDirs.map((d) => d.split('/').pop()).join(', ')}
                      </dd>
                    </div>
                  )}
                </dl>
              </Card>
            );
          })}
        </div>
      )}
      <ProjectDialog open={dialog.open} project={dialog.project} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
    </div>
  );
}
