import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Github, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Project } from '@factory/shared';
import { api } from '@/lib/api';
import { toastError } from '@/lib/toasts';
import { Button, Dialog, Field, Input, Select, Spinner, Textarea } from './ui';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ProjectDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (v: boolean) => void; project?: Project | null }) {
  const qc = useQueryClient();
  const editing = !!project;
  const [repoPath, setRepoPath] = useState('');
  const [name, setName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [checksCommand, setChecks] = useState('');
  const [setupCommand, setSetup] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRepoPath(project?.repoPath ?? '');
    setName(project?.name ?? '');
    setDefaultBranch(project?.defaultBranch ?? '');
    setChecks(project?.checksCommand ?? '');
    setSetup(project?.setupCommand ?? '');
    setNotes(project?.notes ?? '');
    setTouched(!!project);
  }, [open, project]);

  const debounced = useDebounced(repoPath, 400);
  const { data: info, isFetching } = useQuery({
    queryKey: ['inspect', debounced],
    queryFn: () => api.inspect(debounced),
    enabled: open && debounced.trim().length > 1,
  });
  useEffect(() => {
    if (!info?.ok || touched) return;
    setName(info.name ?? '');
    setDefaultBranch(info.defaultBranch ?? '');
    setChecks(info.suggestedChecks ?? '');
    setSetup(info.suggestedSetup ?? '');
  }, [info, touched]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, defaultBranch, checksCommand: checksCommand || null, setupCommand: setupCommand || null, notes: notes || null };
      return editing ? api.updateProject(project!.id, body) : api.createProject({ ...body, repoPath });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(editing ? 'Project saved' : 'Project added');
      onOpenChange(false);
    },
    onError: toastError,
  });

  const branches = info?.branches ?? (project ? [project.defaultBranch] : []);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={editing ? `Edit ${project!.name}` : 'Add a repository'}
      description="A local git checkout. Agents never touch it directly: each ticket gets its own worktree and factory/* branch."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name || (!editing && !info?.ok)} loading={save.isPending} onClick={() => save.mutate()}>
            {editing ? 'Save' : 'Add project'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Repository path" hint={!editing ? 'Absolute path or ~/… to the root of a git repository.' : undefined}>
          <Input value={repoPath} disabled={editing} onChange={(e) => setRepoPath(e.target.value)} placeholder="~/workspace/my-app" className="font-mono text-xs" autoFocus={!editing} />
        </Field>
        {!editing && debounced.trim().length > 1 && (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-black/20 px-3 py-2 text-xs">
            {isFetching ? (
              <Spinner />
            ) : info?.ok ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-zinc-300">Git repository</span>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-400">{info.branches?.length ?? 0} branch{info.branches?.length === 1 ? '' : 'es'}</span>
                {info.github && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <Github className="h-3.5 w-3.5 text-zinc-400" /> <span className="truncate text-zinc-400">{info.remoteUrl}</span>
                  </>
                )}
                {info.remoteUrl && !info.github && <span className="truncate text-zinc-500">· origin is not GitHub (branches are pushed, no PRs)</span>}
                {!info.remoteUrl && <span className="text-amber-300/80">· no origin remote (branches stay local, no PRs)</span>}
              </>
            ) : (
              <>
                <XCircle className="h-3.5 w-3.5 text-rose-400" />
                <span className="text-rose-200">{info?.error}</span>
              </>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => (setTouched(true), setName(e.target.value))} />
          </Field>
          <Field label="Default base branch">
            <Select value={defaultBranch} onChange={(e) => (setTouched(true), setDefaultBranch(e.target.value))}>
              {[...new Set([defaultBranch, ...branches].filter(Boolean))].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Checks command" hint="The gate. Runs in each worktree after every build and fix; a failure goes straight to a fixer, never to a reviewer.">
          <Input value={checksCommand} onChange={(e) => (setTouched(true), setChecks(e.target.value))} placeholder="pnpm lint && pnpm test" className="font-mono text-xs" />
        </Field>
        <Field label="Setup command" hint="Runs once in each fresh worktree before the executor starts (installs dependencies).">
          <Input value={setupCommand} onChange={(e) => (setTouched(true), setSetup(e.target.value))} placeholder="pnpm install --frozen-lockfile" className="font-mono text-xs" />
        </Field>
        <Field label="Notes for agents" hint="Optional. Conventions or context every planner should know. CLAUDE.md in the repo is read automatically.">
          <Textarea value={notes} onChange={(e) => (setTouched(true), setNotes(e.target.value))} className="min-h-[70px]" />
        </Field>
      </div>
    </Dialog>
  );
}
