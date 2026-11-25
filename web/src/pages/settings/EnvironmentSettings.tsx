import { CheckCircle2, Cpu, HardDrive, XCircle } from 'lucide-react';
import { Card, CardHeader, Skeleton } from '@/components/ui';
import { useHealth } from '@/lib/queries';
import { shortPath } from '@/lib/utils';

export function EnvironmentSettings() {
  const { data: health, isLoading } = useHealth();
  return (
    <Card>
      <CardHeader icon={<Cpu />} title="What the server found on this machine" description="Checked every 30 seconds." />
      {isLoading || !health ? (
        <div className="grid grid-cols-1 gap-3 p-4 @md:grid-cols-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 divide-y divide-line-subtle @md:grid-cols-3 @md:divide-x @md:divide-y-0">
            <HealthItem ok={health.db} label="Postgres" detail={health.db ? 'Connected (docker)' : 'Not reachable: run pnpm db:up'} />
            <HealthItem ok={health.claude.ok} label="Claude Code CLI" detail={health.claude.ok ? `${health.claude.version} · ${shortPath(health.claude.path)}` : 'Not found: set CLAUDE_BIN'} />
            <HealthItem ok={health.gh.ok} label="GitHub CLI" detail={health.gh.ok ? `Signed in as ${health.gh.user}` : 'Not signed in: pull requests are off'} />
          </div>
          <div className="flex items-center gap-2 border-t border-line-subtle px-4 py-3 text-xs text-ink-secondary">
            <HardDrive className="size-3.5" /> State directory, with run folders and worktrees: <span className="font-mono text-ink">{shortPath(health.home)}</span>
          </div>
        </>
      )}
    </Card>
  );
}

function HealthItem({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 p-4">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ink-good" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-ink-bad" />}
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="truncate text-xs text-ink-secondary" title={detail}>
          {detail}
        </div>
      </div>
    </div>
  );
}
