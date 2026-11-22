import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FolderOpen, Github, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { EnvironmentSuggestion, Project } from '@factory/shared';
import { api } from '@/lib/api';
import { toastError } from '@/lib/toasts';
import { FolderBrowser } from './FolderBrowser';
import { Button, Combobox, Dialog, Field, Input, Spinner, TagInput, Textarea } from './ui';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const COMMAND_CHARS_PER_ROW = 88;

function commandRows(command: string): number {
  return Math.min(5, Math.max(1, Math.ceil(command.length / COMMAND_CHARS_PER_ROW)));
}

type FieldName = 'name' | 'defaultBranch' | 'checksCommand' | 'setupCommand' | 'copyFiles' | 'referenceDirs' | 'notes';

function useEditedFields(open: boolean, project?: Project | null) {
  const [edited, setEdited] = useState<Set<FieldName>>(new Set());
  useEffect(() => {
    if (open) setEdited(new Set());
  }, [open, project]);
  return { isEdited: (f: FieldName) => edited.has(f), markEdited: (f: FieldName) => setEdited((s) => new Set(s).add(f)) };
}

function DiscoveryStatus({
  suggestion,
  loading,
  error,
  editing,
  onRun,
}: {
  suggestion: EnvironmentSuggestion | undefined;
  loading: boolean;
  error: Error | null;
  editing: boolean;
  onRun: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-violet-400/20 bg-violet-500/[0.06] px-3 py-2 text-xs text-violet-100/90" data-testid="discovery-status">
        <Spinner className="text-violet-300" />
        <span>Claude is reading CLAUDE.md, AGENTS.md, CI config and scripts to work out setup and checks for this repo. This takes a minute or two.</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-200" data-testid="discovery-status">
        <XCircle className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Discovery failed: {error.message}</span>
        <Button size="xs" variant="outline" icon={<RefreshCw className="h-3 w-3" />} onClick={onRun}>
          Retry
        </Button>
      </div>
    );
  }
  if (!suggestion || suggestion.source !== 'claude') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-black/20 px-3 py-2 text-xs text-zinc-400" data-testid="discovery-status">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="flex-1">
          {editing
            ? "Let Claude re-read the repo's docs and CI and propose fresh commands. Nothing changes until you save."
            : "Commands below come from lockfiles and package scripts only. Let Claude read the repo's docs and CI to find the real ones."}
        </span>
        <Button size="xs" variant="outline" icon={<Sparkles className="h-3 w-3" />} onClick={onRun}>
          Discover
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-emerald-400/20 bg-emerald-500/[0.05] px-3 py-2 text-xs" data-testid="discovery-status">
      <div className="flex items-center gap-2 text-emerald-100/90">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
        <span className="flex-1">
          Discovered by Claude from the repo's own docs and config
          {suggestion.costUsd != null && <span className="text-emerald-200/50"> · ${suggestion.costUsd.toFixed(2)}</span>}
        </span>
        <Button size="xs" variant="ghost" icon={<RefreshCw className="h-3 w-3" />} onClick={onRun}>
          Re-run
        </Button>
      </div>
      {suggestion.evidence.length > 0 && (
        <details className="group pl-5 text-2xs leading-relaxed text-zinc-400">
          <summary className="cursor-pointer select-none text-zinc-500 hover:text-zinc-300">
            Why these commands ({suggestion.evidence.length} note{suggestion.evidence.length === 1 ? '' : 's'})
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {suggestion.evidence.map((e) => (
              <li key={e} className="list-disc">
                {e}
              </li>
            ))}
          </ul>
        </details>
      )}
      {suggestion.prerequisites.length > 0 && (
        <div className="flex gap-2 rounded-md bg-amber-500/[0.08] px-2 py-1.5 text-2xs leading-relaxed text-amber-200/90">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <div>
            <div className="font-medium">The checks need these running on your machine:</div>
            {suggestion.prerequisites.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProjectDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (v: boolean) => void; project?: Project | null }) {
  const qc = useQueryClient();
  const editing = !!project;
  const [repoPath, setRepoPath] = useState('');
  const [name, setName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [checksCommand, setChecks] = useState('');
  const [setupCommand, setSetup] = useState('');
  const [copyFiles, setCopyFiles] = useState<string[]>([]);
  const [referenceDirs, setReferenceDirs] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [browsingRefs, setBrowsingRefs] = useState(false);
  const { isEdited, markEdited } = useEditedFields(open, project);

  useEffect(() => {
    if (!open) return;
    setRepoPath(project?.repoPath ?? '');
    setName(project?.name ?? '');
    setDefaultBranch(project?.defaultBranch ?? '');
    setChecks(project?.checksCommand ?? '');
    setSetup(project?.setupCommand ?? '');
    setCopyFiles(project?.copyFiles ?? []);
    setReferenceDirs(project?.referenceDirs ?? []);
    setNotes(project?.notes ?? '');
    setBrowsing(!project);
    setBrowsingRefs(false);
  }, [open, project]);

  const debounced = useDebounced(repoPath, 400);
  const { data: inspected, isFetching } = useQuery({
    queryKey: ['inspect', debounced],
    queryFn: () => api.inspect(debounced),
    enabled: open && !editing && debounced.trim().length > 1,
  });
  const info = debounced === repoPath ? inspected : undefined;
  const { data: projectBranches } = useQuery({
    queryKey: ['branches', project?.id],
    queryFn: () => api.branches(project!.id),
    enabled: open && editing,
  });

  const discoveryPath = editing ? project!.repoPath : info?.ok ? info.path : null;
  const discoveryKey = ['discover', discoveryPath];
  const discovery = useQuery({
    queryKey: discoveryKey,
    queryFn: () => api.discover(discoveryPath!),
    enabled: open && !editing && !!discoveryPath,
    staleTime: Infinity,
    retry: false,
  });
  const rediscover = useMutation({
    mutationFn: () => api.discover(discoveryPath!, true),
    onSuccess: (s) => qc.setQueryData(discoveryKey, s),
  });
  useEffect(() => {
    if (open) rediscover.reset();
  }, [open, project]);
  const claudeSuggestion = editing ? rediscover.data : discovery.data;
  const suggestion = claudeSuggestion ?? info?.suggestion;

  useEffect(() => {
    if (!info?.ok) return;
    setBrowsing(false);
    if (!isEdited('name')) setName(info.name ?? '');
    if (!isEdited('defaultBranch')) setDefaultBranch(info.defaultBranch ?? '');
  }, [info]);

  useEffect(() => {
    if (!suggestion || (editing && suggestion.source !== 'claude')) return;
    if (!isEdited('checksCommand')) setChecks(suggestion.checksCommand ?? '');
    if (!isEdited('setupCommand')) setSetup(suggestion.setupCommand ?? '');
    if (!isEdited('copyFiles')) setCopyFiles(suggestion.copyFiles);
    if (!isEdited('referenceDirs')) setReferenceDirs(suggestion.referenceDirs);
  }, [suggestion]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        defaultBranch,
        checksCommand: checksCommand || null,
        setupCommand: setupCommand || null,
        copyFiles,
        referenceDirs,
        notes: notes || null,
      };
      return editing ? api.updateProject(project!.id, body) : api.createProject({ ...body, repoPath });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(editing ? 'Project saved' : 'Project added');
      onOpenChange(false);
    },
    onError: toastError,
  });

  const branches = editing ? projectBranches?.branches ?? [project!.defaultBranch] : info?.branches ?? [];
  const discovering = (!editing && discovery.isFetching) || rediscover.isPending;
  const discoveryError = (rediscover.error ?? (editing ? null : discovery.error)) as Error | null;
  const repoSelected = editing || !!info?.ok;

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
          <Button variant="primary" disabled={!name || !defaultBranch || (!editing && !info?.ok)} loading={save.isPending} onClick={() => save.mutate()}>
            {editing ? 'Save' : 'Add project'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Field label="Repository" hint={!editing ? 'Pick a folder below, or paste an absolute path or ~/… to the root of a git repository.' : undefined}>
            <div className="flex gap-2">
              <Input
                value={repoPath}
                disabled={editing}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="~/workspace/my-app"
                className="font-mono text-xs"
              />
              {!editing && (
                <Button variant="secondary" size="md" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => setBrowsing((b) => !b)}>
                  Browse
                </Button>
              )}
            </div>
          </Field>
          {!editing && browsing && (
            <FolderBrowser
              mode="repository"
              start={info?.ok ? info.path.replace(/\/[^/]+$/, '') : undefined}
              onPick={(p) => {
                setRepoPath(p);
                setBrowsing(false);
              }}
              onClose={() => setBrowsing(false)}
            />
          )}
          {!editing && debounced.trim().length > 1 && (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-black/20 px-3 py-2 text-xs">
              {isFetching ? (
                <Spinner />
              ) : info?.ok ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-zinc-300">Git repository</span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-400">
                    {info.branches?.length ?? 0} branch{info.branches?.length === 1 ? '' : 'es'}
                  </span>
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
        </div>

        {repoSelected && (
          <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => (markEdited('name'), setName(e.target.value))} />
            </Field>
            <Field label="Default base branch" group hint={branches.length > 1 ? 'Newest first. Type to search.' : undefined}>
              <Combobox value={defaultBranch} options={branches} placeholder="Search branches" onChange={(b) => (markEdited('defaultBranch'), setDefaultBranch(b))} />
            </Field>
          </div>

          <DiscoveryStatus suggestion={claudeSuggestion} loading={discovering} error={discoveryError} editing={editing} onRun={() => rediscover.mutate()} />

          <Field label="Checks command" hint="The gate: formatting, lint and type checks, no tests (CI runs those on the PR, and the fixer re-runs only the ones that fail there). Runs in each worktree after every build and fix; a failure goes straight to a fixer. $FACTORY_BASE is the ref the branch is diffed against, so a large repo can check only what changed.">
            <Textarea
                value={checksCommand}
                onChange={(e) => (markEdited('checksCommand'), setChecks(e.target.value))}
                placeholder="pnpm lint && pnpm typecheck"
                rows={commandRows(checksCommand)}
                className="min-h-0 font-mono text-xs"
              />
          </Field>
          <Field label="Setup command" hint="Runs once in each fresh worktree before the executor starts (installs dependencies); if it fails, the ticket waits for you.">
            <Textarea
                value={setupCommand}
                onChange={(e) => (markEdited('setupCommand'), setSetup(e.target.value))}
                placeholder="pnpm install --frozen-lockfile"
                rows={commandRows(setupCommand)}
                className="min-h-0 font-mono text-xs"
              />
          </Field>
          <Field
            group
            label="Files copied into each worktree"
            hint="Gitignored files from your checkout, such as .env, so tests and agents can reach your dev services. Agents get the variables in their shell; secret values are redacted from every log. Tracked files are never copied."
          >
            <TagInput values={copyFiles} onChange={(v) => (markEdited('copyFiles'), setCopyFiles(v))} placeholder=".env" />
          </Field>
          <div className="space-y-2">
            <Field
              group
              label={
                <span className="flex items-center justify-between">
                  <span>Reference folders</span>
                  <Button size="xs" variant="ghost" icon={<FolderOpen className="h-3 w-3" />} onClick={() => setBrowsingRefs((b) => !b)}>
                    Browse
                  </Button>
                </span>
              }
              hint="Local checkouts agents may read but never edit, such as an SDK this repo uses or the service it calls."
            >
              <TagInput values={referenceDirs} onChange={(v) => (markEdited('referenceDirs'), setReferenceDirs(v))} placeholder="~/workspace/some-sdk" />
            </Field>
            {browsingRefs && (
              <FolderBrowser
                mode="folder"
                start={(editing ? project!.repoPath : info?.ok ? info.path : '').replace(/\/[^/]+$/, '') || undefined}
                onPick={(p) => {
                  markEdited('referenceDirs');
                  setReferenceDirs((dirs) => (dirs.includes(p) ? dirs : [...dirs, p]));
                }}
                onClose={() => setBrowsingRefs(false)}
              />
            )}
          </div>
          <Field label="Notes for agents" hint="Optional. Conventions or context every planner should know. The repo's CLAUDE.md, .claude/rules and skills are used automatically, and Cursor rules and AGENTS.md files are pointed out to every agent.">
            <Textarea value={notes} onChange={(e) => (markEdited('notes'), setNotes(e.target.value))} className="min-h-[70px]" />
          </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
