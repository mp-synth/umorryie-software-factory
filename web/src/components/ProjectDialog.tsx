import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FolderOpen, Github, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatCheckPolicy, parseCheckPolicy, type EnvironmentSuggestion, type Project } from '@factory/shared';
import { api } from '@/lib/api';
import { toastError } from '@/lib/toasts';
import { FolderBrowser } from './FolderBrowser';
import { Button, Callout, Combobox, Dialog, Field, Input, Spinner, SwitchRow, TagInput, Textarea } from './ui';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const COMMAND_CHARS_PER_ROW = 88;
const commandRows = (command: string) => Math.min(5, Math.max(1, Math.ceil(command.length / COMMAND_CHARS_PER_ROW)));

type FieldName = 'name' | 'defaultBranch' | 'checksCommand' | 'setupCommand' | 'copyFiles' | 'referenceDirs' | 'notes';

/** Fields the user changed by hand: a suggestion arriving later must not overwrite them. */
function useEditedFields(open: boolean, project?: Project | null) {
  const [edited, setEdited] = useState<Set<FieldName>>(new Set());
  useEffect(() => {
    if (open) setEdited(new Set());
  }, [open, project]);
  return { isEdited: (f: FieldName) => edited.has(f), markEdited: (f: FieldName) => setEdited((s) => new Set(s).add(f)) };
}

function DiscoveryStatus({ suggestion, loading, error, editing, onRun }: { suggestion: EnvironmentSuggestion | undefined; loading: boolean; error: Error | null; editing: boolean; onRun: () => void }) {
  if (loading) {
    return (
      <Callout tone="accent" icon={<Spinner className="text-ink-accent" />} title="Claude is reading the repository">
        It reads CLAUDE.md, AGENTS.md, the CI config and scripts to work out the setup and checks commands. This takes a minute or two.
      </Callout>
    );
  }
  if (error) {
    return (
      <Callout tone="bad" title="Discovery failed" actions={<Button size="sm" variant="outline" icon={<RefreshCw />} onClick={onRun}>Try again</Button>}>
        {error.message}
      </Callout>
    );
  }
  if (!suggestion || suggestion.source !== 'claude') {
    return (
      <Callout tone="neutral" icon={<Sparkles />} title={editing ? 'Re-read the repository' : 'Commands from lockfiles and package scripts'} actions={<Button size="sm" variant="outline" icon={<Sparkles />} onClick={onRun}>Discover</Button>}>
        {editing
          ? "Let Claude re-read the repo's docs and CI and propose fresh commands. Nothing changes until you save."
          : "Let Claude read the repo's docs and CI to find the commands the team really uses."}
      </Callout>
    );
  }
  return (
    <Callout
      tone="good"
      icon={<Sparkles />}
      title={`Discovered by Claude from the repo's own docs and config${suggestion.costUsd != null ? ` · $${suggestion.costUsd.toFixed(2)}` : ''}`}
      actions={
        <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={onRun}>
          Re-run
        </Button>
      }
    >
      {suggestion.evidence.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-xs font-medium text-ink-secondary hover:text-ink">
            Why these commands ({suggestion.evidence.length} note{suggestion.evidence.length === 1 ? '' : 's'})
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {suggestion.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      {suggestion.prerequisites.length > 0 && (
        <Callout tone="warn" className="mt-2" title="The checks need these running on your machine">
          {suggestion.prerequisites.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Callout>
      )}
    </Callout>
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
  const [fixCommand, setFixCommand] = useState('');
  const [mergeCheckCommand, setMergeCheck] = useState('');
  const [quickChecksCommand, setQuickChecks] = useState('');
  const [checkPolicy, setCheckPolicy] = useState('');
  const [generatedPaths, setGeneratedPaths] = useState<string[]>([]);
  const [skipAgentCommitHooks, setSkipHooks] = useState(false);
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
    setFixCommand(project?.fixCommand ?? '');
    setMergeCheck(project?.mergeCheckCommand ?? '');
    setQuickChecks(project?.quickChecksCommand ?? '');
    setCheckPolicy(formatCheckPolicy(project?.checkPolicy ?? []));
    setGeneratedPaths(project?.generatedPaths ?? []);
    setSkipHooks(project?.skipAgentCommitHooks ?? false);
    setCopyFiles(project?.copyFiles ?? []);
    setReferenceDirs(project?.referenceDirs ?? []);
    setNotes(project?.notes ?? '');
    setBrowsing(!project);
    setBrowsingRefs(false);
  }, [open, project]);

  const debounced = useDebounced(repoPath, 400);
  const { data: inspected, isFetching } = useQuery({ queryKey: ['inspect', debounced], queryFn: () => api.inspect(debounced), enabled: open && !editing && debounced.trim().length > 1 });
  const info = debounced === repoPath ? inspected : undefined;
  const { data: projectBranches } = useQuery({ queryKey: ['branches', project?.id], queryFn: () => api.branches(project!.id), enabled: open && editing });

  const discoveryPath = editing ? project!.repoPath : info?.ok ? info.path : null;
  const discoveryKey = ['discover', discoveryPath];
  const discovery = useQuery({ queryKey: discoveryKey, queryFn: () => api.discover(discoveryPath!), enabled: open && !editing && !!discoveryPath, staleTime: Infinity, retry: false });
  const rediscover = useMutation({ mutationFn: () => api.discover(discoveryPath!, true), onSuccess: (s) => qc.setQueryData(discoveryKey, s) });
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
        fixCommand: fixCommand || null,
        mergeCheckCommand: mergeCheckCommand || null,
        quickChecksCommand: quickChecksCommand || null,
        checkPolicy: policy.rules,
        generatedPaths,
        skipAgentCommitHooks,
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

  const policy = parseCheckPolicy(checkPolicy);
  const branches = editing ? (projectBranches?.branches ?? [project!.defaultBranch]) : (info?.branches ?? []);
  const discovering = (!editing && discovery.isFetching) || rediscover.isPending;
  const discoveryError = (rediscover.error ?? (editing ? null : discovery.error)) as Error | null;
  const repoSelected = editing || !!info?.ok;
  const missing = !editing && !info?.ok ? 'Pick a git repository' : !name ? 'Give the project a name' : !defaultBranch ? 'Pick the default base branch' : policy.errors[0] ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? `Edit ${project!.name}` : 'Add a repository'}
      description="A local git checkout. Agents never touch it directly: each ticket gets its own worktree and factory/* branch."
      footerStart={missing}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!!missing} loading={save.isPending} onClick={() => save.mutate()}>
            {editing ? 'Save' : 'Add project'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="eyebrow mb-2">Repository</legend>
          <Field label="Folder" hint={!editing ? 'Pick a folder below, or paste an absolute path or ~/… to the root of a git repository.' : undefined}>
            <div className="flex gap-2">
              <Input value={repoPath} disabled={editing} onChange={(e) => setRepoPath(e.target.value)} placeholder="~/workspace/my-app" className="font-mono text-sm" />
              {!editing && (
                <Button variant="secondary" icon={<FolderOpen />} onClick={() => setBrowsing((b) => !b)}>
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
            <div className="flex min-h-control-md flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-sunken px-3 py-2 text-sm">
              {isFetching ? (
                <>
                  <Spinner /> <span className="text-ink-secondary">Looking at the folder…</span>
                </>
              ) : info?.ok ? (
                <>
                  <CheckCircle2 className="size-4 text-ink-good" />
                  <span className="text-ink">Git repository</span>
                  <span className="text-ink-tertiary">·</span>
                  <span className="text-ink-secondary">
                    {info.branches?.length ?? 0} branch{info.branches?.length === 1 ? '' : 'es'}
                  </span>
                  {info.github && (
                    <span className="flex min-w-0 items-center gap-1.5 text-ink-secondary">
                      <span className="text-ink-tertiary">·</span>
                      <Github className="size-4" /> <span className="truncate">{info.remoteUrl}</span>
                    </span>
                  )}
                  {info.remoteUrl && !info.github && <span className="truncate text-ink-tertiary">· origin is not GitHub: branches are pushed, no PRs</span>}
                  {!info.remoteUrl && <span className="text-ink-warn">· no origin remote: branches stay local, no PRs</span>}
                </>
              ) : (
                <>
                  <XCircle className="size-4 text-ink-bad" />
                  <span className="text-ink-bad">{info?.error}</span>
                </>
              )}
            </div>
          )}
          {repoSelected && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input value={name} onChange={(e) => (markEdited('name'), setName(e.target.value))} />
              </Field>
              <Field label="Default base branch" group hint={branches.length > 1 ? 'Newest first. Type to search.' : undefined}>
                <Combobox value={defaultBranch} options={branches} placeholder="Search branches" onChange={(b) => (markEdited('defaultBranch'), setDefaultBranch(b))} />
              </Field>
            </div>
          )}
        </fieldset>

        {repoSelected && (
          <>
            <fieldset className="space-y-3">
              <legend className="eyebrow mb-2">Commands</legend>
              <DiscoveryStatus suggestion={claudeSuggestion} loading={discovering} error={discoveryError} editing={editing} onRun={() => rediscover.mutate()} />
              <Field
                label="Checks command"
                optional
                hint="The gate: what CI must not fail on (lint, generated files, the tests of the changed files), run by the factory after every build and fix and before anything is pushed. $FACTORY_BASE is the ref the branch is diffed against, $FACTORY_SLOT (1 to 15) is unique among the gates running at once, for a test database. Exit 75 means trouble outside the code: the gate runs again later, no fixer starts. Exit 3 records WAITING-ON- lines: no fixer starts and the result is not a green readiness proof. An absolute script path uses that live file immediately when it changes."
              >
                <Textarea
                  value={checksCommand}
                  onChange={(e) => (markEdited('checksCommand'), setChecks(e.target.value))}
                  placeholder="pnpm lint && pnpm typecheck"
                  rows={commandRows(checksCommand)}
                  className="min-h-0 font-mono text-sm"
                />
              </Field>
              <Field label="Fix command" optional hint="Autofixers the factory runs on a branch before its checks (formatters, lint autofix, regenerated specs). It never commits; the factory commits what changed. Also regenerates generated files when only they conflict in a merge. An absolute script path uses that live file immediately when it changes.">
                <Textarea value={fixCommand} onChange={(e) => setFixCommand(e.target.value)} placeholder="pnpm exec prettier --write . && pnpm lint --fix" rows={commandRows(fixCommand)} className="min-h-0 font-mono text-sm" />
              </Field>
              <Field label="Merge check command" optional hint="A fast check (imports, generated files) after the factory merges the PR below into a branch, before it pushes that merge. Without it the full checks command runs.">
                <Textarea value={mergeCheckCommand} onChange={(e) => setMergeCheck(e.target.value)} placeholder="pnpm typecheck" rows={commandRows(mergeCheckCommand)} className="min-h-0 font-mono text-sm" />
              </Field>
              <Field label="Quick checks for agents" optional hint="What agents may run themselves on the files they changed (lint, types). They never run the checks command; the gate does.">
                <Textarea value={quickChecksCommand} onChange={(e) => setQuickChecks(e.target.value)} placeholder="pnpm exec eslint $(git diff --name-only $FACTORY_BASE...HEAD)" rows={commandRows(quickChecksCommand)} className="min-h-0 font-mono text-sm" />
              </Field>
              <SwitchRow
                label="Agents skip the commit hooks"
                description="Opt in only when the gate reproduces every hook, including secret scanning. A later fix commit cannot remove a secret from earlier commit history."
                checked={skipAgentCommitHooks}
                onChange={setSkipHooks}
              />
              <Field label="Setup command" optional hint="Runs once in each fresh worktree before the executor starts, such as installing dependencies. If it fails, the ticket waits for you.">
                <Textarea
                  value={setupCommand}
                  onChange={(e) => (markEdited('setupCommand'), setSetup(e.target.value))}
                  placeholder="pnpm install --frozen-lockfile"
                  rows={commandRows(setupCommand)}
                  className="min-h-0 font-mono text-sm"
                />
              </Field>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="eyebrow mb-2">Pull requests</legend>
              <Field
                label="Check policy"
                optional
                error={policy.errors.join('; ') || undefined}
                hint="How the PR sweep treats a failing check, one rule per line: must-fix, fix, people-only, ignore or waiting-on, then a pattern for the check name, optionally 'when' and a pattern for its log, and '::' and a note. Checks no rule names follow the factory's defaults (Meticulous and code-owner reviews wait on people; lint, tests and specs are always fixed)."
              >
                <Textarea
                  value={checkPolicy}
                  onChange={(e) => setCheckPolicy(e.target.value)}
                  placeholder={'people-only ^Meticulous :: a visual diff\nwaiting-on ^Lint$ when Generated types are out of sync :: types ahead of the backend spec'}
                  rows={Math.max(3, checkPolicy.split('\n').length)}
                  className="min-h-0 font-mono text-sm"
                />
              </Field>
              <Field group optional label="Generated files" hint="Globs of generated files (idl/**, *.gen.ts): a merge conflict only in these is resolved by the fix command instead of an agent.">
                <TagInput values={generatedPaths} onChange={setGeneratedPaths} placeholder="idl/**" />
              </Field>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="eyebrow mb-2">Context for agents</legend>
              <Field
                group
                optional
                label="Files copied into each worktree"
                hint="Gitignored files from your checkout, such as .env, so tests and agents can reach your dev services. Agents get the variables in their shell; secret values are redacted from every log. Tracked files are never copied."
              >
                <TagInput values={copyFiles} onChange={(v) => (markEdited('copyFiles'), setCopyFiles(v))} placeholder=".env" />
              </Field>
              <Field
                group
                optional
                label="Reference folders"
                aside={
                  <Button size="xs" variant="ghost" icon={<FolderOpen />} onClick={() => setBrowsingRefs((b) => !b)}>
                    Browse
                  </Button>
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
              <Field
                label="Notes for agents"
                optional
                hint="Conventions or context every planner should know. The repo's CLAUDE.md, .claude/rules and skills are used automatically, and Cursor rules and AGENTS.md files are pointed out to every agent."
              >
                <Textarea value={notes} onChange={(e) => (markEdited('notes'), setNotes(e.target.value))} className="min-h-[5rem]" />
              </Field>
            </fieldset>
          </>
        )}
      </div>
    </Dialog>
  );
}
