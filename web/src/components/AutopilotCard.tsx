import { useMutation } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import type { Initiative, InitiativeSettings, Model } from '@factory/shared';
import { api } from '@/lib/api';
import { toastError } from '@/lib/toasts';
import { Card, CardHeader, Select, Switch } from './ui';

const TOGGLES: { key: keyof InitiativeSettings; label: string }[] = [
  { key: 'autoPlanReview', label: 'Review every plan' },
  { key: 'autoExecute', label: 'Build after approval' },
  { key: 'autoReview', label: 'Review every branch' },
  { key: 'autoFix', label: 'Fix findings automatically' },
  { key: 'createPrs', label: 'Push & open draft PRs' },
  { key: 'postReviewsToPr', label: 'Post reviews on PRs' },
];

const MODELS: { key: keyof InitiativeSettings['models']; label: string }[] = [
  { key: 'plan', label: 'Planner' },
  { key: 'plan_review', label: 'Plan reviewer' },
  { key: 'execute', label: 'Executor' },
  { key: 'review', label: 'Reviewer' },
  { key: 'fix', label: 'Fixer' },
  { key: 'mechanicalFix', label: 'Fixer (CI/lint only)' },
  { key: 'ask', label: 'Advisor' },
];

export function AutopilotCard({ initiative: i }: { initiative: Initiative }) {
  const save = useMutation({
    mutationFn: (settings: Partial<InitiativeSettings>) => api.updateInitiative(i.id, { settings }),
    onError: toastError,
  });
  const s = i.settings;
  return (
    <Card>
      <CardHeader icon={<Gauge className="h-3.5 w-3.5" />} title="Autopilot" sub="What runs without you pressing a button" />
      <div className="divide-y divide-line">
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2">
            <span className="text-xs text-zinc-300">{t.label}</span>
            <Switch label={t.label} checked={s[t.key] as boolean} onChange={(v) => save.mutate({ [t.key]: v })} />
          </label>
        ))}
        <div className="grid grid-cols-3 gap-2 px-4 py-3">
          <NumberField label="Rounds" value={s.maxRounds} min={1} max={10} onChange={(v) => save.mutate({ maxRounds: v })} />
          <NumberField label="Parallel" value={s.concurrency} min={1} max={10} onChange={(v) => save.mutate({ concurrency: v })} />
          <NumberField label="Plan rounds" value={s.maxPlanRounds} min={1} max={5} onChange={(v) => save.mutate({ maxPlanRounds: v })} />
        </div>
        <div className="space-y-1.5 px-4 py-3">
          <div className="section-title mb-1">Models</div>
          {MODELS.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-400">{m.label}</span>
              <div className="w-[104px]">
                <Select value={s.models[m.key]} onChange={(e) => save.mutate({ models: { ...s.models, [m.key]: e.target.value as Model } })} className="h-7 text-2xs">
                  <option value="opus">Opus</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="haiku">Haiku</option>
                </Select>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-2xs text-zinc-500">{label}</span>
      <div className="mt-1 flex h-7 items-center rounded-md border border-line-strong bg-black/30">
        <button className="h-full w-6 text-zinc-500 hover:text-zinc-200 disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)} type="button">
          −
        </button>
        <span className="flex-1 text-center font-mono text-xs tabular-nums text-zinc-200">{value}</span>
        <button className="h-full w-6 text-zinc-500 hover:text-zinc-200 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)} type="button">
          +
        </button>
      </div>
    </label>
  );
}
