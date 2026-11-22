import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Cpu, HardDrive, Settings2, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PR_SWEEP_CLAIM_MINUTES, PR_SWEEP_INTERVAL_MINUTES, type AppSettings } from '@factory/shared';
import { api } from '@/lib/api';
import { toastError, toastSuccess } from '@/lib/toasts';
import { shortPath } from '@/lib/utils';
import { Button, Card, CardHeader, Field, Input, Spinner, Switch } from '@/components/ui';

export function SettingsPage() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const { data: health, isLoading: healthLoading } = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 30_000 });
  const [form, setForm] = useState<AppSettings | null>(null);
  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);
  const save = useMutation({
    mutationFn: (s: Partial<AppSettings>) => api.updateSettings(s),
    onSuccess: toastSuccess('Settings saved'),
    onError: toastError,
  });
  const sweep = useMutation({
    mutationFn: api.sweepPrs,
    onSuccess: ({ count }) => toast.success(count ? `Started a fixer on ${count} PR${count > 1 ? 's' : ''}` : 'No open PR needs a fix'),
    onError: toastError,
  });

  return (
    <div className="mx-auto max-w-[1000px] space-y-5 px-6 py-8 lg:px-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Limits for every agent the factory starts. Per-initiative autopilot and models live on each initiative.</p>
      </header>

      <Card>
        <CardHeader icon={<Cpu className="h-3.5 w-3.5" />} title="Environment" sub="What the server found on this machine" />
        <div className="grid gap-px bg-line sm:grid-cols-3">
          {healthLoading || !health ? (
            <div className="col-span-3 bg-surface p-4">
              <Spinner />
            </div>
          ) : (
            <>
              <HealthItem ok={health.db} label="Postgres" detail={health.db ? 'connected (docker)' : 'not reachable — run pnpm db:up'} />
              <HealthItem ok={health.claude.ok} label="Claude Code CLI" detail={health.claude.ok ? `${health.claude.version} · ${shortPath(health.claude.path)}` : 'not found — set CLAUDE_BIN'} />
              <HealthItem ok={health.gh.ok} label="GitHub CLI" detail={health.gh.ok ? `signed in as ${health.gh.user}` : 'not signed in — PRs disabled'} />
            </>
          )}
        </div>
        {health && (
          <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-2xs text-zinc-500">
            <HardDrive className="h-3 w-3" /> State directory (run folders, worktrees): <span className="font-mono text-zinc-300">{shortPath(health.home)}</span>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader icon={<Settings2 className="h-3.5 w-3.5" />} title="Agent limits" />
        {!form ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-5 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Agents running at once" hint="Across every initiative, shared fairly: each initiative gets an agent before any gets a second. Gates (checks) count too.">
                <Input type="number" min={1} max={40} value={form.maxConcurrentAgents} onChange={(e) => setForm({ ...form, maxConcurrentAgents: Number(e.target.value) })} />
              </Field>
              <Field label="Agent timeout (minutes)" hint="A run that exceeds this is stopped and marked failed.">
                <Input type="number" min={5} max={600} value={form.runTimeoutMinutes} onChange={(e) => setForm({ ...form, runTimeoutMinutes: Number(e.target.value) })} />
              </Field>
              <Field label="Checks timeout (minutes)">
                <Input type="number" min={1} max={180} value={form.gateTimeoutMinutes} onChange={(e) => setForm({ ...form, gateTimeoutMinutes: Number(e.target.value) })} />
              </Field>
              <Field label="Spend cap per run (USD)" hint="Optional. Passed to claude --max-budget-usd.">
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  placeholder="no cap"
                  value={form.maxBudgetUsdPerRun ?? ''}
                  onChange={(e) => setForm({ ...form, maxBudgetUsdPerRun: e.target.value ? Number(e.target.value) : null })}
                />
              </Field>
            </div>
            <Toggle
              label="Load my user-level Claude settings into agents"
              hint="Off (recommended): agents start clean — no user hooks, plugins or MCP servers — so nothing pollutes their context. The repo's own .claude settings and CLAUDE.md still apply."
              checked={form.loadUserSettings}
              onChange={(v) => setForm({ ...form, loadUserSettings: v })}
            />
            <Toggle
              label={`Fix open PRs every ${PR_SWEEP_INTERVAL_MINUTES} minutes`}
              hint={`Merge conflicts, failing CI (tests, lint) and unanswered review comments get a fresh fixer, on every open factory PR and on every open PR you opened in a project's repo (adopted into that project's Open PRs initiative; archive it to stop). Tickets that need you are skipped. A PR being fixed is marked so the next sweep leaves it alone; the mark expires after ${PR_SWEEP_CLAIM_MINUTES} minutes.`}
              checked={form.sweepOpenPrs}
              onChange={(v) => setForm({ ...form, sweepOpenPrs: v })}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" loading={sweep.isPending} onClick={() => sweep.mutate()}>
                Sweep PRs now
              </Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>
                Save
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="How the factory works" />
        <ol className="space-y-3 p-4 text-xs leading-relaxed text-zinc-400">
          {[
            ['Plan', 'A fresh planner (Opus) reads the repo read-only and writes plan.md + plan.json: goal, success criteria, definition of done, edge cases, test strategy, and small dependency-ordered tickets. The server validates the JSON (schema, sizes, DAG).'],
            ['Plan review', 'A second fresh agent checks coverage, slicing, dependencies and that every path the plan names exists. REVISE sends a new planner its findings.'],
            ['Your approval', 'You read the high-level overview first, then approve or request changes. Nothing touches code before this.'],
            ['Build', 'Each ticket gets its own git worktree and factory/* branch, stacked on its dependency when needed, and a fresh executor that commits there.'],
            ['Checks', 'The project checks command runs in the worktree. A failure goes to a fixer — no reviewer time is spent on a red build. Green branches are pushed and opened as draft PRs.'],
            ['Review', 'A fresh reviewer with no memory of the build reads the diff, verifies each finding and answers APPROVE or CHANGES.'],
            ['Fix', 'A fresh fixer triages every finding, failing CI check, merge conflict, unresolved PR thread and your feedback as VALID / INVALID / NEEDS-HUMAN, fixes what is real with tests, then checks and review run again.'],
          ].map(([t, d], n) => (
            <li key={t} className="flex gap-3">
              <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line-strong font-mono text-[10px] text-zinc-400">{n + 1}</span>
              <span>
                <span className="font-medium text-zinc-200">{t}.</span> {d}
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function HealthItem({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 bg-surface p-4">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />}
      <div className="min-w-0">
        <div className="text-xs font-medium text-zinc-200">{label}</div>
        <div className="truncate text-2xs text-zinc-500" title={detail}>
          {detail}
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-black/20 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-zinc-200">{label}</div>
        <div className="mt-0.5 text-2xs leading-relaxed text-zinc-500">{hint}</div>
      </div>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}
