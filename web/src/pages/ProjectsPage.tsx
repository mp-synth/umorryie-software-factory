import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, FolderGit2, Github, GitBranch, KeyRound, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Project } from '@factory/shared';
import { useAppActions } from '@/components/shell/app-actions';
import { usePageMeta } from '@/components/shell/page-meta';
import { Button, Card, Chip, EmptyState, IconButton, Menu, MenuItem, Page, PageHeader, Skeleton, Tooltip, confirmAction } from '@/components/ui';
import { api } from '@/lib/api';
import { useInitiatives, useProjects } from '@/lib/queries';
import { isNotArchived } from '@/lib/status';
import { toastError, toastSuccess } from '@/lib/toasts';
import { shortPath } from '@/lib/utils';

export function ProjectsPage() {
  usePageMeta('Projects');
  const { addProject } = useAppActions();
  const { data: projects, isLoading } = useProjects();
  const { data: initiatives = [] } = useInitiatives();

  return (
    <Page>
      <PageHeader
        title="Projects"
        description="Local repositories the factory builds in. The checks command is the gate every branch must pass before a reviewer looks at it."
        actions={
          <Button variant="primary" icon={<Plus />} onClick={addProject}>
            Add a project
          </Button>
        }
      />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : !projects?.length ? (
        <Card>
          <EmptyState
            icon={<FolderGit2 />}
            title="No projects yet"
            actions={
              <Button variant="primary" icon={<Plus />} onClick={addProject}>
                Add your first repository
              </Button>
            }
          >
            Point the factory at a git checkout on this machine. It reads CLAUDE.md, detects branches and suggests a checks command.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} initiatives={initiatives.filter((i) => i.projectId === p.id && isNotArchived(i)).length} />
          ))}
        </div>
      )}
    </Page>
  );
}

function ProjectCard({ project: p, initiatives }: { project: Project; initiatives: number }) {
  const { editProject } = useAppActions();
  const remove = useMutation({ mutationFn: () => api.deleteProject(p.id), onSuccess: toastSuccess('Project removed'), onError: toastError });
  const askRemove = async () => {
    const ok = await confirmAction({ title: `Remove ${p.name} from the factory?`, description: 'The repository itself is not touched.', confirmLabel: 'Remove project', danger: true });
    if (ok) remove.mutate();
  };
  const github = p.remoteUrl && /github\.com[:/]/.test(p.remoteUrl) ? p.remoteUrl.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') : null;
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-neutral-subtle text-ink-secondary">
          <FolderGit2 className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-md font-medium text-ink">{p.name}</div>
          <div className="truncate font-mono text-xs text-ink-tertiary" title={p.repoPath}>
            {shortPath(p.repoPath)}
          </div>
        </div>
        <Menu trigger={<IconButton label="Project actions" icon={<MoreHorizontal />} />}>
          <MenuItem icon={<Pencil />} onSelect={() => editProject(p)}>
            Edit
          </MenuItem>
          <MenuItem icon={<Trash2 />} danger onSelect={askRemove} description="The repository is not touched">
            Remove from the factory
          </MenuItem>
        </Menu>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip icon={<GitBranch />} mono>
          {p.defaultBranch}
        </Chip>
        {github ? (
          <Chip icon={<Github />} title={p.remoteUrl ?? undefined}>
            {github}
          </Chip>
        ) : p.remoteUrl ? (
          <Chip title={p.remoteUrl}>Not GitHub · no PRs</Chip>
        ) : (
          <Chip>Local only · no PRs</Chip>
        )}
        <Chip>
          {initiatives} initiative{initiatives === 1 ? '' : 's'}
        </Chip>
      </div>
      <dl className="mt-4 space-y-2 border-t border-line-subtle pt-3 text-sm">
        <Fact icon={<ShieldCheck />} label="Checks">
          {p.checksCommand ?? (
            <span className="inline-flex items-center gap-1 font-sans text-ink-warn">
              <AlertTriangle className="size-3.5" /> None: the gate is skipped
            </span>
          )}
        </Fact>
        <Fact icon={<Wrench />} label="Setup">
          {p.setupCommand ?? '—'}
        </Fact>
        {p.copyFiles.length > 0 && (
          <Fact icon={<KeyRound />} label="Copies">
            {p.copyFiles.join(', ')}
          </Fact>
        )}
        {p.referenceDirs.length > 0 && (
          <Fact icon={<BookOpen />} label="Reads" title={p.referenceDirs.join('\n')}>
            {p.referenceDirs.map((d) => d.split('/').pop()).join(', ')}
          </Fact>
        )}
      </dl>
    </Card>
  );
}

function Fact({ icon, label, children, title }: { icon: ReactNode; label: string; children: ReactNode; title?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-ink-tertiary [&_svg]:size-4">{icon}</span>
      <dt className="w-14 shrink-0 text-ink-secondary">{label}</dt>
      <Tooltip content={title}>
        <dd className="min-w-0 truncate font-mono text-xs text-ink">{children}</dd>
      </Tooltip>
    </div>
  );
}
