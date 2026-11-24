import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FolderGit2, GitBranch, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DEFAULT_INITIATIVE_SETTINGS, type InitiativeSettings } from '@factory/shared';
import { api } from '@/lib/api';
import { toastError } from '@/lib/toasts';
import { Button, Combobox, Dialog, Field, Input, Select, Switch, Textarea } from './ui';

const AUTOPILOT: { key: keyof InitiativeSettings; label: string; hint: string }[] = [
  { key: 'autoPlanReview', label: 'Review the plan', hint: 'A fresh reviewer checks the plan against the code before you see it.' },
  { key: 'autoExecute', label: 'Build after approval', hint: 'Tickets start as soon as their dependencies are approved.' },
  { key: 'autoReview', label: 'Review every branch', hint: 'A fresh reviewer runs after each build or fix.' },
  { key: 'autoFix', label: 'Fix review findings', hint: 'A fresh fixer handles CHANGES and failing checks, up to the round limit.' },
  { key: 'createPrs', label: 'Push & open draft PRs', hint: 'Needs a GitHub origin and gh auth. Never force-pushes or merges.' },
  {
    key: 'autoArbiter',
    label: 'Arbiter decides for you',
    hint: 'When the plan waits for approval, the planner has questions or a ticket needs you, a fresh Fable arbiter approves, answers or sends it back. You get only what it cannot decide.',
  },
];

export function NewInitiativeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: api.projects, enabled: open });
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [settings, setSettings] = useState<InitiativeSettings>(DEFAULT_INITIATIVE_SETTINGS);

  useEffect(() => {
    if (open && !projectId && projects.length) setProjectId(projects[0].id);
  }, [open, projects, projectId]);

  const { data: branchData } = useQuery({
    queryKey: ['branches', projectId],
    queryFn: () => api.branches(projectId),
    enabled: open && !!projectId,
  });
  useEffect(() => {
    if (branchData) setBaseBranch(branchData.defaultBranch);
  }, [branchData]);

  const create = useMutation({
    mutationFn: () => api.createInitiative({ projectId, title, brief, baseBranch, settings, start: true }),
    onSuccess: (init) => {
      qc.invalidateQueries({ queryKey: ['initiatives'] });
      toast.success('Initiative created — the planner is starting');
      onOpenChange(false);
      setTitle('');
      setBrief('');
      navigate(`/i/${init.id}`);
    },
    onError: toastError,
  });

  const canSubmit = projectId && title.trim().length >= 3 && brief.trim().length >= 10 && baseBranch;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="New initiative"
      description="Describe the outcome. A fresh planner reads the repo, plans it, and splits it into small tickets."
      footer={
        <>
          <span className="mr-auto text-2xs text-zinc-500">
            Planning starts immediately · {settings.autoArbiter ? 'the arbiter approves the plan unless it needs you' : 'nothing is built until you approve'}
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSubmit} loading={create.isPending} onClick={() => create.mutate()} icon={<Sparkles className="h-3.5 w-3.5" />}>
            Create & plan
          </Button>
        </>
      }
    >
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong p-6 text-center">
          <FolderGit2 className="mx-auto h-6 w-6 text-zinc-500" />
          <p className="mt-2 text-sm text-zinc-300">Add a local repository first.</p>
          <p className="mt-1 text-xs text-zinc-500">Projects are git repos on this machine. Agents work in worktrees next to them.</p>
          <Link to="/projects" onClick={() => onOpenChange(false)}>
            <Button className="mt-4" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />}>
              Go to Projects
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Repository">
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field group label={<span className="flex items-center gap-1.5"><GitBranch className="h-3 w-3" /> Base branch</span>}>
              <Combobox value={baseBranch} onChange={setBaseBranch} options={branchData?.branches ?? []} placeholder="Search branches" />
            </Field>
          </div>
          <Field label="Title">
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Team invites with email verification" maxLength={120} />
          </Field>
          <Field
            label="Brief"
            hint={`What should be true when this is done? Constraints, non-goals, links. Paste any URL — a PR or file in another repo (e.g. TTVPlatform), an open-source repo, docs — and every agent gets it as a local read-only copy. ${settings.autoArbiter ? "The arbiter answers the planner's questions from this brief, so put your preferences here." : 'The planner asks you if something blocks it.'}`}
          >
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              className="min-h-[180px] font-mono text-[12.5px]"
              placeholder={`Users can invite teammates by email.\n\n- Invite expires after 7 days\n- Only admins can invite\n- Reuse the existing mailer in src/lib/mail.ts\n\nOut of scope: SSO.`}
            />
          </Field>
          <div>
            <div className="section-title mb-2">Autopilot</div>
            <div className="divide-y divide-line rounded-xl border border-line bg-black/20">
              {AUTOPILOT.map((a) => (
                <div key={a.key} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-zinc-200">{a.label}</div>
                    <div className="text-2xs text-zinc-500">{a.hint}</div>
                  </div>
                  <Switch label={a.label} checked={settings[a.key] as boolean} onChange={(v) => setSettings((s) => ({ ...s, [a.key]: v }))} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
