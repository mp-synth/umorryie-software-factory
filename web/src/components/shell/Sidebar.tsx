import { ChevronRight, Keyboard, Monitor, Moon, PanelLeftClose, Palette, Plus, Search, Sun } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import type { InitiativeSummary } from '@factory/shared';
import { InitiativeGlyph } from '@/components/StatusBadge';
import { Button, Count, Dot, IconButton, Kbd, Menu, MenuItem, MenuLabel, MenuRadioGroup, MenuSeparator, Skeleton, Tooltip } from '@/components/ui';
import { initiativeSignal, sidebarGroup, type SidebarGroup } from '@/lib/initiative';
import { toggleGroup, toggleSidebar, useLayout } from '@/lib/layout';
import { poolSize, useCapacity } from '@/lib/live';
import { setPreferences, usePreferences, type ModePreference } from '@/lib/preferences';
import { useActiveRuns, useInbox, useInitiatives } from '@/lib/queries';
import { MOD } from '@/lib/shortcuts';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';
import { NAV } from './nav';

const GROUPS: { key: SidebarGroup; label: string }[] = [
  { key: 'needs-you', label: 'Needs you' },
  { key: 'working', label: 'Working' },
  { key: 'idle', label: 'Idle' },
  { key: 'done', label: 'Done' },
];
const DONE_SHOWN = 8;

export function Sidebar({ connected, onCreate, onSearch, onHelp }: { connected: boolean; onCreate: () => void; onSearch: () => void; onHelp: () => void }) {
  const { sidebarCollapsed } = useLayout();
  const { sidebar } = usePreferences();
  const narrow = useMediaQuery('(max-width: 900px)');
  const collapsed = sidebarCollapsed || narrow;
  const inverted = sidebar === 'inverted';
  const { data: initiatives = [], isLoading } = useInitiatives();
  const { data: active = [] } = useActiveRuns();
  const waiting = useInbox().total;
  const running = active.filter((r) => r.status === 'running').length;
  const counts: Record<string, { n: number; tone: 'warn' | 'active' } | undefined> = {
    '/inbox': waiting ? { n: waiting, tone: 'warn' } : undefined,
    '/agents': running ? { n: running, tone: 'active' } : undefined,
  };

  return (
    <aside
      aria-label="Sidebar"
      data-surface={inverted ? 'inverted' : undefined}
      className={cn('flex shrink-0 flex-col text-ink transition-[width] duration-hover ease-framework', collapsed ? 'w-[3.75rem]' : 'w-[17rem]', inverted && 'rounded-xl bg-canvas')}
    >
      <div className={cn('flex h-12 shrink-0 items-center gap-2.5', collapsed ? 'justify-center' : 'px-3')}>
        {collapsed ? (
          <Tooltip content="Expand the sidebar" shortcut="[" side="right">
            <button type="button" onClick={toggleSidebar} aria-label="Expand the sidebar" className="rounded-lg">
              <Logo />
            </button>
          </Tooltip>
        ) : (
          <>
            <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg">
              <Logo />
              <span className="min-w-0 leading-tight">
                <span className="heading block truncate text-base text-ink">Software Factory</span>
                <span className="block truncate text-2xs text-ink-tertiary">Fresh-context agents · local</span>
              </span>
            </Link>
            {!narrow && <IconButton label="Collapse the sidebar" shortcut="[" icon={<PanelLeftClose />} onClick={toggleSidebar} tooltipSide="right" />}
          </>
        )}
      </div>

      <div className={cn('space-y-1.5 pb-3 pt-1', collapsed ? 'px-2.5' : 'px-2')}>
        {collapsed ? (
          <>
            <IconButton label="New initiative" shortcut="C" variant="primary" size="md" icon={<Plus />} onClick={onCreate} tooltipSide="right" className="w-full" />
            <IconButton label="Search" shortcut={`${MOD}K`} size="md" icon={<Search />} onClick={onSearch} tooltipSide="right" className="w-full" />
          </>
        ) : (
          <>
            <Button variant="primary" className="w-full" icon={<Plus />} onClick={onCreate} end={<Kbd className="ml-auto border-transparent bg-ink-on-primary/15 text-ink-on-primary">C</Kbd>}>
              <span className="flex-1 text-left">New initiative</span>
            </Button>
            <button
              type="button"
              onClick={onSearch}
              className="flex h-control-sm w-full items-center gap-2 rounded-md border border-line-subtle px-2.5 text-sm text-ink-tertiary transition-colors hover:border-line hover:text-ink-secondary"
            >
              <Search className="size-3.5" />
              <span className="flex-1 text-left">Search or jump to…</span>
              <Kbd>{MOD}K</Kbd>
            </button>
          </>
        )}
      </div>

      <nav aria-label="Main" className={cn('space-y-0.5', collapsed ? 'px-2.5' : 'px-2')}>
        {NAV.map((n) => {
          const count = counts[n.to];
          return (
            <Tooltip key={n.to} content={collapsed ? (count ? `${n.label} · ${count.n}` : n.label) : null} side="right">
              <SidebarLink to={n.to} end={n.to === '/'} aria-label={collapsed ? n.label : undefined} className={cn('relative [&_svg]:size-4', collapsed ? 'justify-center' : 'px-2')}>
                <n.icon className="shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
                {count && (collapsed ? <Dot tone={count.tone} live={count.tone === 'active'} className="absolute right-1.5 top-1.5" /> : <Count n={count.n} tone={count.tone} />)}
              </SidebarLink>
            </Tooltip>
          );
        })}
      </nav>

      {collapsed ? <div className="flex-1" /> : <InitiativeGroups initiatives={initiatives} loading={isLoading} />}

      <SidebarFooter connected={connected} running={running} queued={active.length - running} collapsed={collapsed} onHelp={onHelp} />
    </aside>
  );
}

function InitiativeGroups({ initiatives, loading }: { initiatives: InitiativeSummary[]; loading: boolean }) {
  const { foldedGroups } = useLayout();
  const groups = GROUPS.map((g) => ({ ...g, items: initiatives.filter((i) => sidebarGroup(i) === g.key) })).filter((g) => g.items.length);
  return (
    <div className="no-scrollbar mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3">
      {loading && (
        <div className="space-y-2 px-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      )}
      {!loading && groups.length === 0 && <p className="px-2 text-xs text-ink-tertiary">Initiatives you create show up here.</p>}
      {groups.map((g) => {
        const folded = foldedGroups.includes(g.key);
        const shown = g.key === 'done' ? g.items.slice(0, DONE_SHOWN) : g.items;
        return (
          <section key={g.key} aria-label={g.label}>
            <button
              type="button"
              onClick={() => toggleGroup(g.key)}
              aria-expanded={!folded}
              className="group flex h-6 w-full items-center gap-1.5 rounded-sm px-2 text-left text-xs font-medium text-ink-tertiary transition-colors hover:text-ink-secondary"
            >
              <span>{g.label}</span>
              <span className="numeric">{g.items.length}</span>
              <ChevronRight className={cn('size-3 transition-transform', !folded && 'rotate-90')} />
            </button>
            {!folded && (
              <ul className="mt-0.5 space-y-px">
                {shown.map((i) => (
                  <li key={i.id}>
                    <InitiativeLink initiative={i} />
                  </li>
                ))}
                {g.items.length > shown.length && (
                  <li>
                    <Link to="/?filter=done" className="block px-2 py-1 text-xs text-ink-tertiary hover:text-ink">
                      All {g.items.length} done initiatives
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * A sidebar link that works out its own active state, so its class name stays a string: a tooltip
 * trigger merges class names as strings, which breaks NavLink's function form.
 */
const SidebarLink = forwardRef<HTMLAnchorElement, { to: string; end?: boolean; className?: string; children: ReactNode; 'aria-label'?: string }>(function SidebarLink(
  { to, end, className, children, ...props },
  ref,
) {
  const active = !!useMatch({ path: to, end: end ?? false });
  return (
    <Link
      ref={ref}
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-control-sm items-center gap-2.5 rounded-md text-sm transition-colors duration-quick',
        active ? 'bg-selected font-medium text-ink' : 'text-ink-secondary hover:bg-hover hover:text-ink',
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
});

function InitiativeLink({ initiative: i }: { initiative: InitiativeSummary }) {
  const signal = initiativeSignal(i);
  return (
    <Tooltip content={`${signal.label} · ${i.projectName}`} side="right">
      <SidebarLink to={`/i/${i.id}`} className="px-2">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <InitiativeGlyph initiative={i} />
        </span>
        <span className="min-w-0 flex-1 truncate">{i.title}</span>
        {i.activeRuns > 0 && <span className="numeric text-2xs text-ink-tertiary">{i.activeRuns}</span>}
      </SidebarLink>
    </Tooltip>
  );
}

const MODE_ICONS: Record<ModePreference, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

function SidebarFooter({ connected, running, queued, collapsed, onHelp }: { connected: boolean; running: number; queued: number; collapsed: boolean; onHelp: () => void }) {
  const capacity = useCapacity();
  const navigate = useNavigate();
  const { mode } = usePreferences();
  const ModeIcon = MODE_ICONS[mode];
  const status = connected ? 'Live' : 'Reconnecting…';
  const detail = connected
    ? `Updates arrive the moment they happen.${capacity ? ` ${capacity.running} running in a ${poolSize(capacity)}.` : ''}`
    : 'The connection to the factory server dropped. It reconnects on its own.';
  return (
    <div className={cn('mt-auto shrink-0 border-t border-line-subtle p-2', collapsed && 'flex flex-col items-center gap-1')}>
      <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
        <Tooltip content={detail} side={collapsed ? 'right' : 'top'}>
          <Link to="/agents" className={cn('flex h-control-sm min-w-0 items-center gap-2 rounded-md text-xs text-ink-secondary transition-colors hover:bg-hover hover:text-ink', collapsed ? 'w-control-sm justify-center' : 'flex-1 px-2')}>
            <Dot tone={connected ? 'good' : 'warn'} live={!connected} />
            {!collapsed && (
              <span className="truncate">
                <span className={cn('font-medium', connected ? 'text-ink' : 'text-ink-warn')}>{status}</span>
                <span className="text-ink-tertiary"> · </span>
                <span className="numeric">{running}</span> running
                {queued > 0 && <span className="text-ink-tertiary"> · {queued} queued</span>}
              </span>
            )}
          </Link>
        </Tooltip>
        <Menu
          align={collapsed ? 'start' : 'end'}
          side={collapsed ? 'right' : 'top'}
          trigger={<IconButton label="Appearance" icon={<ModeIcon />} tooltipSide={collapsed ? 'right' : 'top'} />}
        >
          <MenuLabel>Theme</MenuLabel>
          <MenuRadioGroup
            value={mode}
            onChange={(m) => setPreferences({ mode: m })}
            options={[
              { value: 'system', label: 'Match the system', icon: <Monitor /> },
              { value: 'light', label: 'Light', icon: <Sun /> },
              { value: 'dark', label: 'Dark', icon: <Moon /> },
            ]}
          />
          <MenuSeparator />
          <MenuItem icon={<Palette />} onSelect={() => navigate('/settings/appearance')} description="Accent, density, text size, typeface…">
            Customize appearance
          </MenuItem>
        </Menu>
        {!collapsed && <IconButton label="Keyboard shortcuts" shortcut="?" icon={<Keyboard />} onClick={onHelp} />}
      </div>
    </div>
  );
}
