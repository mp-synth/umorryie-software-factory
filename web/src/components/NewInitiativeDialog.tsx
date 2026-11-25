import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FolderGit2, GitBranch, Plus, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DEFAULT_INITIATIVE_SETTINGS, type InitiativeSettings } from '@factory/shared';
import { api } from '@/lib/api';
import { useProjects } from '@/lib/queries';
import { MOD } from '@/lib/shortcuts';
import { toastError } from '@/lib/toasts';
import { cn } from '@/lib/utils';
import { Button, Combobox, Dialog, EmptyState, Field, Input, Select, SwitchRow, Textarea } from './ui';

const AUTOPILOT: { key: keyof InitiativeSettings; label: string; hint: string }[] = [
  { key: 'autoPlanReview', label: 'Review the plan', hint: 'A fresh reviewer checks the plan against the code before you see it.' },
  { key: 'autoExecute', label: 'Build after approval', hint: 'Tickets start as soon as their dependencies are approved.' },
  { key: 'autoReview', label: 'Review every branch', hint: 'A fresh reviewer runs after each build or fix.' },
  { key: 'autoFix', label: 'Fix review findings', hint: 'A fresh fixer handles requested changes and failing checks, up to the round limit.' },
  { key: 'createPrs', label: 'Push and open draft PRs', hint: 'Needs a GitHub origin and gh auth. Never force-pushes or merges.' },
  {
    key: 'autoArbiter',
    label: 'Arbiter decides for you',
    hint: 'When the plan waits for approval, the planner has questions or a ticket needs you, a fresh arbiter approves, answers or sends it back. You only get what it cannot decide.',
  },
];

const MIN_TITLE = 3;
const MIN_BRIEF = 10;

export function NewInitiativeDialog({ open, onOpenChange, onAddProject }: { open: boolean; onOpenChange: (v: boolean) => void; onAddProject: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: projects = [], isPending } = useProjects(open);
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [settings, setSettings] = useState<InitiativeSettings>(DEFAULT_INITIATIVE_SETTINGS);
  const [showAutopilot, setShowAutopilot] = useState(false);

  useEffect(() => {
    if (open && !projectId && projects.length) setProjectId(projects[0].id);
  }, [open, projects, projectId]);

  const { data: branchData } = useQuery({ queryKey: ['branches', projectId], queryFn: () => api.branches(projectId), enabled: open && !!projectId });
  useEffect(() => {
    if (branchData) setBaseBranch(branchData.defaultBranch);
  }, [branchData]);

  const create = useMutation({
    mutationFn: () => api.createInitiative({ projectId, title: title.trim(), brief, baseBranch, settings, start: true }),
    onSuccess: (init) => {
      qc.invalidateQueries({ queryKey: ['initiatives'] });
      toast.success('Initiative created. The planner is starting.');
      onOpenChange(false);
      setTitle('');
      setBrief('');
      navigate(`/i/${init.id}`);
    },
    onError: toastError,
  });

  const missing = !projectId
    ? 'Pick a repository'
    : !baseBranch
      ? 'Pick a base branch'
      : title.trim().length < MIN_TITLE
        ? 'Give it a title'
        : brief.trim().length < MIN_BRIEF
          ? 'Describe the outcome in the brief'
          : null;
  const submit = () => !missing && !create.isPending && create.mutate();
  const onCount = AUTOPILOT.filter((a) => settings[a.key]).length;

  if (open && !isPending && projects.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title="New initiative" size="sm">
        <EmptyState
          icon={<FolderGit2 />}
          title="Add a repository first"
          actions={
            <Button
              variant="primary"
              icon={<Plus />}
              onClick={() => {
                onOpenChange(false);
                onAddProject();
              }}
            >
              Add a project
            </Button>
          }
        >
          Initiatives are built in a project: a git repository on this machine. Agents work in worktrees next to it, so your checkout is never touched.
        </EmptyState>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="New initiative"
      description="Describe the outcome you want. A fresh planner reads the repository, plans it and splits it into small tickets for you to approve."
      footerStart={missing ?? (settings.autoArbiter ? 'Planning starts right away. The arbiter approves the plan unless it needs you.' : 'Planning starts right away. Nothing is built until you approve the plan.')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!!missing} loading={create.isPending} onClick={submit} icon={<Sparkles />} title={`${MOD}↵`}>
            Create and start planning
          </Button>
        </>
      }
    >
      <div
        className="space-y-6"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <fieldset className="space-y-3">
          <legend className="eyebrow mb-2">Where</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Repository">
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              group
              label={
                <span className="inline-flex items-center gap-1.5">
                  <GitBranch className="size-3.5 text-ink-tertiary" /> Base branch
                </span>
              }
            >
              <Combobox value={baseBranch} onChange={setBaseBranch} options={branchData?.branches ?? []} placeholder="Search branches" />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="eyebrow mb-2">What</legend>
          <Field label="Title">
            <Input data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Team invites with email verification" maxLength={120} />
          </Field>
          <Field
            label="Brief"
            hint={`What should be true when this is done? Constraints, non-goals, links. Paste any URL, such as a PR or file in another repo, an open-source repo or docs, and every agent gets a local read-only copy. ${settings.autoArbiter ? "The arbiter answers the planner's questions from this brief, so put your preferences here." : 'The planner asks you if something blocks it.'}`}
          >
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              className="min-h-[11rem] font-mono text-sm"
              placeholder={`Users can invite teammates by email.\n\n- Invite expires after 7 days\n- Only admins can invite\n- Reuse the existing mailer in src/lib/mail.ts\n\nOut of scope: SSO.`}
            />
          </Field>
        </fieldset>

        <fieldset>
          <legend className="sr-only">Autopilot</legend>
          <button
            type="button"
            onClick={() => setShowAutopilot((v) => !v)}
            aria-expanded={showAutopilot}
            className="flex w-full items-center gap-3 rounded-lg border border-line-subtle px-3.5 py-3 text-left transition-colors hover:bg-hover"
          >
            <ChevronRight className={cn('size-4 text-ink-tertiary transition-transform', showAutopilot && 'rotate-90')} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">Autopilot</span>
              <span className="block text-xs text-ink-secondary">
                {onCount === AUTOPILOT.length ? 'Everything runs on its own: you approve the plan, agents do the rest.' : `${onCount} of ${AUTOPILOT.length} steps run on their own.`}{' '}
                You can change this later on the initiative.
              </span>
            </span>
            <span className="text-xs font-medium text-ink-accent">{showAutopilot ? 'Hide' : 'Customize'}</span>
          </button>
          {showAutopilot && (
            <div className="mt-2 animate-fade-in divide-y divide-line-subtle overflow-hidden rounded-lg border border-line-subtle">
              {AUTOPILOT.map((a) => (
                <SwitchRow key={a.key} label={a.label} description={a.hint} checked={settings[a.key] as boolean} onChange={(v) => setSettings((s) => ({ ...s, [a.key]: v }))} />
              ))}
            </div>
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}
