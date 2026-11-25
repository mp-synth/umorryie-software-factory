import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, GitPullRequest } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DEFAULT_APP_SETTINGS, MAX_MANUAL_AGENTS, PR_SWEEP_CLAIM_MINUTES, PR_SWEEP_INTERVAL_MINUTES, type AppSettings, type CapacityStatus } from '@factory/shared';
import { Badge, Button, Card, CardHeader, Field, Input, Spinner, SwitchRow } from '@/components/ui';
import { api } from '@/lib/api';
import { poolNote, poolSize, useCapacity } from '@/lib/live';
import { toastError, toastSuccess } from '@/lib/toasts';

const logins = (text: string) =>
  text
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

export function AgentSettings() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [form, setForm] = useState<AppSettings | null>(null);
  const [noiseAuthors, setNoiseAuthors] = useState('');
  const capacity = useCapacity();
  useEffect(() => {
    if (!settings) return;
    setForm(settings);
    setNoiseAuthors((settings.prNoiseCommentAuthors ?? DEFAULT_APP_SETTINGS.prNoiseCommentAuthors).join(', '));
  }, [settings]);
  const save = useMutation({ mutationFn: (s: Partial<AppSettings>) => api.updateSettings(s), onSuccess: toastSuccess('Settings saved'), onError: toastError });
  const sweep = useMutation({
    mutationFn: api.sweepPrs,
    onSuccess: ({ count }) => toast.success(count ? `Started a fixer on ${count} PR${count > 1 ? 's' : ''}` : 'No open PR needs a fix'),
    onError: toastError,
  });

  if (!form || !settings) {
    return (
      <Card className="p-6">
        <Spinner />
      </Card>
    );
  }
  const next: AppSettings = { ...form, prNoiseCommentAuthors: logins(noiseAuthors) };
  const dirty = JSON.stringify(next) !== JSON.stringify({ ...settings, prNoiseCommentAuthors: settings.prNoiseCommentAuthors ?? DEFAULT_APP_SETTINGS.prNoiseCommentAuthors });
  const set = (patch: Partial<AppSettings>) => setForm({ ...form, ...patch });

  return (
    <div className="space-y-5 pb-20">
      <p className="text-pretty text-sm text-ink-secondary">Limits for every agent the factory starts. Autopilot and models are set per initiative, under its Autopilot tab.</p>
      <Card>
        <CardHeader icon={<Bot />} title="Agents" />
        <div className="divide-y divide-line-subtle">
          {form.autoScaleAgents !== undefined && (
            <SwitchRow
              label="Size the agent pool to this machine"
              description={
                <>
                  On: every initiative works in its own lane, side by side, with as many agents as this machine holds
                  {capacity ? ` (${capacity.ceiling} on ${capacity.cores} cores and ${capacity.memoryGb} GB)` : ''}. An initiative with work always has at least one agent, even when the pool is full.
                  While the machine is short on CPU or memory, new agents wait. Off: the fixed number below, as a hard limit.
                  {capacity && <PoolNow capacity={capacity} />}
                </>
              }
              checked={form.autoScaleAgents}
              onChange={(v) => set({ autoScaleAgents: v })}
            />
          )}
          <div className="grid grid-cols-1 gap-4 px-4 py-4 @md:grid-cols-2">
            {!form.autoScaleAgents && (
              <Field label="Agents running at once" hint="Across every initiative, shared fairly: each initiative gets an agent before any gets a second. Checks count too.">
                <Input type="number" min={1} max={MAX_MANUAL_AGENTS} value={form.maxConcurrentAgents} onChange={(e) => set({ maxConcurrentAgents: Number(e.target.value) })} />
              </Field>
            )}
            <Field label="Agent timeout" hint="Minutes. A run that takes longer is stopped and marked failed.">
              <Input type="number" min={5} max={600} value={form.runTimeoutMinutes} onChange={(e) => set({ runTimeoutMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Checks timeout" hint="Minutes.">
              <Input type="number" min={1} max={180} value={form.gateTimeoutMinutes} onChange={(e) => set({ gateTimeoutMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Spend cap per run" optional hint="USD. Passed to claude --max-budget-usd.">
              <Input
                type="number"
                min={0}
                step="0.5"
                placeholder="No cap"
                value={form.maxBudgetUsdPerRun ?? ''}
                onChange={(e) => set({ maxBudgetUsdPerRun: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>
          </div>
          <SwitchRow
            label="Load my user-level Claude settings into agents"
            description="Off, which is recommended: agents start clean, with no user hooks, plugins or MCP servers, so nothing pollutes their context. The repo's own .claude settings and CLAUDE.md still apply."
            checked={form.loadUserSettings}
            onChange={(v) => set({ loadUserSettings: v })}
          />
          <SwitchRow
            label="Resume steps a restart interrupted"
            description="A restart leaves running agents, checks and setup commands alone, and a step that had not started its agent yet starts over either way. A step whose agent or checks process is gone is queued again once, as long as it was not already interrupted in the same round. Otherwise the ticket waits for you, with the reason shown."
            checked={form.resumeInterruptedRuns ?? true}
            onChange={(v) => set({ resumeInterruptedRuns: v })}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={<GitPullRequest />}
          title="Pull requests"
          actions={
            <Button size="sm" variant="outline" loading={sweep.isPending} onClick={() => sweep.mutate()}>
              Sweep the PRs now
            </Button>
          }
        />
        <div className="divide-y divide-line-subtle">
          <SwitchRow
            label={`Fix open PRs every ${PR_SWEEP_INTERVAL_MINUTES} minutes`}
            description={`Merge conflicts, failing CI (tests, lint) and unanswered review comments get a fresh fixer, on every open factory PR and on every open PR you opened in a project's repo (adopted into that project's Open PRs initiative; archive it to stop). Tickets that need you are skipped. A PR being fixed is marked so the next sweep leaves it alone; the mark expires after ${PR_SWEEP_CLAIM_MINUTES} minutes.`}
            checked={form.sweepOpenPrs}
            onChange={(v) => set({ sweepOpenPrs: v })}
          />
          <div className="px-4 py-4">
            <Field
              label="PR comment authors to ignore"
              hint="Comma-separated logins, with or without [bot]. Their top-level PR comments (coverage, plan and deploy reports) never start a fixer; their review threads, review bodies and failing checks still do."
            >
              <Input value={noiseAuthors} onChange={(e) => setNoiseAuthors(e.target.value)} className="font-mono text-sm" />
            </Field>
          </div>
        </div>
      </Card>

      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border border-line-subtle bg-raised px-4 py-3 shadow-popover">
        {dirty ? <Badge tone="warn" dot>Unsaved changes</Badge> : <span className="text-sm text-ink-tertiary">Everything is saved</span>}
        <Button variant="ghost" disabled={!dirty} onClick={() => setForm(settings)}>
          Discard
        </Button>
        <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(next)}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

function PoolNow({ capacity: c }: { capacity: CapacityStatus }) {
  const held = poolNote(c);
  return (
    <span className="numeric mt-1.5 block text-ink">
      Now: {c.running} running{c.queued ? `, ${c.queued} waiting` : ''} in {c.lanes} initiative{c.lanes === 1 ? '' : 's'} · {poolSize(c)}
      {held ? ` (${held})` : ''} · load {c.loadPerCore} per core · {c.localWorkSlots} setups, checks and checkouts at once
    </span>
  );
}
