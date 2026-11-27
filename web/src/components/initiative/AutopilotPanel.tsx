import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu, Gauge, GitPullRequest, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_INITIATIVE_SETTINGS, EFFORTS, MODEL_VERSIONS, MODELS, type AgentRunKind, type Effort, type InitiativeDetail, type InitiativeSettings, type Model } from '@factory/shared';
import { Card, CardHeader, NumberStepper, Select, SwitchRow } from '@/components/ui';
import { api } from '@/lib/api';
import { toastError } from '@/lib/toasts';

type Toggle = { key: keyof InitiativeSettings; label: string; description: string };

const ON_ITS_OWN: Toggle[] = [
  { key: 'autoPlanReview', label: 'Review every plan', description: 'A fresh reviewer checks each plan against the code before you see it.' },
  { key: 'autoExecute', label: 'Build after approval', description: 'Tickets start as soon as their dependencies are ready.' },
  { key: 'autoReview', label: 'Review every branch', description: 'A fresh reviewer runs after each build or fix.' },
  { key: 'autoFix', label: 'Fix findings automatically', description: 'A fresh fixer handles requested changes and failing checks, up to the round limit.' },
  { key: 'autoArbiter', label: 'Arbiter decides instead of waiting for you', description: 'When a step would wait on you, a fresh arbiter approves, answers or sends it back. You only get what it cannot decide.' },
  { key: 'autoRetro', label: 'Retro once a steered PR merges or queues', description: 'Learns rules from what you had to steer by hand, for you to accept.' },
];

const PULL_REQUESTS: Toggle[] = [
  { key: 'createPrs', label: 'Push and open draft PRs', description: 'Needs a GitHub origin and gh auth. Never force-pushes.' },
  { key: 'postReviewsToPr', label: 'Post reviews on the PRs', description: 'Each review is posted as a comment on its pull request.' },
  { key: 'autoMerge', label: 'Auto-merge approved PRs', description: 'Each approved PR joins the merge queue once the PRs below it merge.' },
  {
    key: 'dependentsStartWhenBuilt',
    label: 'Dependents start once the ticket below is built',
    description: 'A stacked ticket starts once the one below it is built and its PR is open, instead of once it is approved. Its review still waits for that approval.',
  },
  { key: 'dependentsWaitForCi', label: 'Dependents wait for green CI', description: 'A ticket stacked on another starts only once CI on the one below is green.' },
  {
    key: 'foundationCheckpoint',
    label: 'Foundations hold their dependents',
    description: 'A ticket the plan marks as a foundation (the contract others build on) holds the tickets on it until it is approved and its CI is green.',
  },
  {
    key: 'lineInPlanOrder',
    label: 'One GitHub stack in plan order',
    description: 'Every PR opens on the one before it in plan order, so all of them sit in one stack. Tickets still build side by side when what they need is ready.',
  },
  {
    key: 'landStackAtOnce',
    label: 'Land approved stacks in one merge',
    description: 'With auto-merge, the approved and green bottom of a stack joins the merge queue through its highest PR and lands in one go.',
  },
  {
    key: 'resumeFixSessions',
    label: "Fixers continue the last fixer's session",
    description: "A fix round right after a finished one picks up that agent's context instead of reading the repo again. For comparing speed and quality.",
  },
];

const EFFORT_OPTIONS: readonly (Effort | '')[] = ['', ...EFFORTS];

function withEffort(efforts: InitiativeSettings['efforts'], role: AgentRunKind, effort: Effort | ''): InitiativeSettings['efforts'] {
  const next = { ...efforts };
  if (effort) next[role] = effort;
  else delete next[role];
  return next;
}

const ROLES: { key: keyof InitiativeSettings['models']; label: string }[] = [
  { key: 'plan', label: 'Planner' },
  { key: 'plan_review', label: 'Plan reviewer' },
  { key: 'execute', label: 'Executor' },
  { key: 'review', label: 'Reviewer' },
  { key: 'fix', label: 'Fixer' },
  { key: 'mechanicalFix', label: 'Fixer for CI and lint only' },
  { key: 'verify', label: 'Fix verifier' },
  { key: 'arbitrate', label: 'Arbiter' },
  { key: 'ask', label: 'Advisor' },
  { key: 'steer', label: 'Feedback router' },
  { key: 'retro', label: 'Retro' },
];

export function AutopilotPanel({ detail }: { detail: InitiativeDetail }) {
  const { initiative: i } = detail;
  const qc = useQueryClient();
  const key = ['initiative', i.id];
  const save = useMutation({
    mutationFn: (settings: Partial<InitiativeSettings>) => api.updateInitiative(i.id, { settings }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<InitiativeDetail>(key);
      if (before) qc.setQueryData<InitiativeDetail>(key, { ...before, initiative: { ...before.initiative, settings: { ...before.initiative.settings, ...patch } } });
      return { before };
    },
    onSuccess: (_r, patch) => {
      if ('autoMerge' in patch) toast.success(patch.autoMerge ? 'Auto-merge on: each approved PR joins the merge queue once the PRs below it merge' : 'Auto-merge off');
    },
    onError: (e: Error, _patch, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
      toastError(e);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  const s: InitiativeSettings = {
    ...DEFAULT_INITIATIVE_SETTINGS,
    ...i.settings,
    models: { ...DEFAULT_INITIATIVE_SETTINGS.models, ...i.settings.models },
    efforts: { ...DEFAULT_INITIATIVE_SETTINGS.efforts, ...i.settings.efforts },
  };
  const toggles = (list: Toggle[]) => (
    <div className="divide-y divide-line-subtle">
      {list.map((t) => (
        <SwitchRow key={t.key} label={t.label} description={t.description} checked={s[t.key] as boolean} onChange={(v) => save.mutate({ [t.key]: v })} />
      ))}
    </div>
  );

  return (
    <div className="grid grid-cols-1 items-start gap-5 @xl:grid-cols-2">
      <div className="space-y-5">
        <Card>
          <CardHeader icon={<Gauge />} title="What runs on its own" description="Each step you leave on happens without you pressing a button." />
          {toggles(ON_ITS_OWN)}
        </Card>
        <Card>
          <CardHeader icon={<GitPullRequest />} title="Pull requests" />
          {toggles(PULL_REQUESTS)}
        </Card>
      </div>
      <div className="space-y-5">
        <Card>
          <CardHeader icon={<SlidersHorizontal />} title="Limits" description="When a ticket or the plan runs out of rounds, it waits for you." />
          <div className="grid grid-cols-2 gap-4 p-4">
            <NumberStepper label="Fix rounds in a row" hint="Fix rounds on one problem before Fable decides the next step" value={s.maxRounds} min={1} max={10} onChange={(v) => save.mutate({ maxRounds: v })} />
            <NumberStepper label="Tickets at once" hint="Tickets of this initiative built in parallel" value={s.concurrency} min={1} max={10} onChange={(v) => save.mutate({ concurrency: v })} />
            <NumberStepper label="Plan rounds" hint="Plan and review rounds before the plan waits for you" value={s.maxPlanRounds} min={1} max={5} onChange={(v) => save.mutate({ maxPlanRounds: v })} />
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Cpu />} title="Models" description="Which Claude model each agent runs, always with the 1M context window." />
          <div className="space-y-2 p-4">
            {ROLES.map((m) => (
              <label key={m.key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-secondary">{m.label}</span>
                <span className="flex gap-2">
                  <span className="w-36">
                    <Select size="sm" value={s.models[m.key]} onChange={(e) => save.mutate({ models: { ...s.models, [m.key]: e.target.value as Model } })}>
                      {MODELS.map((model) => (
                        <option key={model} value={model}>
                          {MODEL_VERSIONS[model].label}
                        </option>
                      ))}
                    </Select>
                  </span>
                  {m.key !== 'mechanicalFix' && (
                    <span className="w-28">
                      <Select
                        size="sm"
                        aria-label={`${m.label} effort`}
                        value={s.efforts?.[m.key as AgentRunKind] ?? ''}
                        onChange={(e) => save.mutate({ efforts: withEffort(s.efforts ?? {}, m.key as AgentRunKind, e.target.value as Effort | '') })}
                      >
                        {EFFORT_OPTIONS.map((effort) => (
                          <option key={effort} value={effort}>
                            {effort || 'default effort'}
                          </option>
                        ))}
                      </Select>
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
