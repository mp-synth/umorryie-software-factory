import { useQuery } from '@tanstack/react-query';
import { Activity, Factory, FolderGit2, LayoutDashboard, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '@/lib/api';
import { useLiveUpdates } from '@/lib/live';
import { isNotArchived } from '@/lib/status';
import { cn } from '@/lib/utils';
import { NewInitiativeDialog } from './NewInitiativeDialog';
import { RunDrawer } from './RunDrawer';
import { Button, Kbd, Tooltip } from './ui';

export function Layout() {
  const connected = useLiveUpdates();
  const [creating, setCreating] = useState(false);
  const { data: active = [] } = useQuery({ queryKey: ['runs', 'active'], queryFn: () => api.runs({ active: true }), refetchInterval: 15_000 });
  const { data: initiatives = [] } = useQuery({ queryKey: ['initiatives'], queryFn: api.initiatives });
  const running = active.filter((r) => r.status === 'running').length;
  const attention = initiatives.filter((i) => i.attention && isNotArchived(i)).length;

  const nav = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, badge: attention ? { n: attention, tone: 'bg-amber-400/15 text-amber-300' } : null },
    { to: '/agents', label: 'Agents', icon: Activity, badge: running ? { n: running, tone: 'bg-cyan-400/15 text-cyan-300' } : null },
    { to: '/projects', label: 'Projects', icon: FolderGit2, badge: null },
    { to: '/settings', label: 'Settings', icon: Settings2, badge: null },
  ];

  return (
    <div className="flex h-full">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-[#0b0b0f]">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg border border-violet-400/25 bg-gradient-to-br from-violet-500/25 to-cyan-400/10 shadow-glow">
            <Factory className="h-4 w-4 text-violet-200" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight text-zinc-100">Software Factory</div>
            <div className="text-2xs text-zinc-500">local · fresh-context agents</div>
          </div>
        </div>
        <div className="px-3 pb-3">
          <Button variant="primary" className="w-full" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
            New initiative
          </Button>
        </div>
        <nav className="space-y-0.5 px-2">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cn(
                  'group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors',
                  isActive ? 'bg-white/[0.06] text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200',
                )
              }
            >
              <n.icon className="h-4 w-4 opacity-80" />
              <span className="flex-1">{n.label}</span>
              {n.badge && <span className={cn('rounded-full px-1.5 text-2xs font-semibold tabular-nums', n.badge.tone)}>{n.badge.n}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-2">
          <div className="section-title px-2.5 pb-1.5">Initiatives</div>
          <div className="space-y-0.5">
            {initiatives
              .filter(isNotArchived)
              .slice(0, 14)
              .map((i) => (
                <NavLink
                  key={i.id}
                  to={`/i/${i.id}`}
                  className={({ isActive }) =>
                    cn(
                      'flex h-7 items-center gap-2 rounded-md px-2.5 text-xs transition-colors',
                      isActive ? 'bg-white/[0.06] text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300',
                    )
                  }
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      i.activeRuns > 0 ? 'animate-pulse bg-cyan-400' : i.attention ? 'bg-amber-400' : i.status === 'done' ? 'bg-emerald-400' : 'bg-zinc-600',
                    )}
                  />
                  <span className="truncate">{i.title}</span>
                </NavLink>
              ))}
          </div>
        </div>

        <div className="border-t border-line px-4 py-3 text-2xs text-zinc-500">
          <Tooltip content={connected ? 'Live updates connected' : 'Reconnecting to the server…'}>
            <div className="flex items-center gap-2">
              <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-emerald-400' : 'animate-pulse bg-amber-400')} />
              {connected ? 'Live' : 'Reconnecting'}
              <span className="ml-auto flex items-center gap-1">
                <Kbd>{running}</Kbd> running
              </span>
            </div>
          </Tooltip>
        </div>
      </aside>

      <main className="glow-top relative min-w-0 flex-1 overflow-y-auto">
        <Outlet context={{ openNew: () => setCreating(true) }} />
      </main>

      <NewInitiativeDialog open={creating} onOpenChange={setCreating} />
      <RunDrawer />
    </div>
  );
}
