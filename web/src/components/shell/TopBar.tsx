import { PanelRightClose, PanelRightOpen, RefreshCw, Search, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { Badge, Breadcrumbs, Button, IconButton, Kbd } from '@/components/ui';
import { toggleDock, useLayout } from '@/lib/layout';
import { useHealth, useInbox } from '@/lib/queries';
import { MOD } from '@/lib/shortcuts';
import { usePageMetaValue } from './page-meta';

export function TopBar({ onSearch }: { onSearch: () => void }) {
  const { crumbs } = usePageMetaValue();
  const onInitiative = !!useMatch('/i/:id');
  const { dockOpen } = useLayout();
  const waiting = useInbox().total;
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle px-3 @lg:px-4">
      <Breadcrumbs items={crumbs} />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {waiting > 0 && (
          <Link to="/inbox" className="rounded-sm" title="Open the inbox">
            <Badge tone="warn" dot>
              {waiting} waiting on you
            </Badge>
          </Link>
        )}
        <Button variant="ghost" size="sm" icon={<Search />} onClick={onSearch} end={<Kbd>{MOD}K</Kbd>} className="hidden @md:inline-flex">
          Search
        </Button>
        {onInitiative && (
          <IconButton
            label={dockOpen ? 'Hide the live agents panel' : 'Show the live agents panel'}
            shortcut="]"
            icon={dockOpen ? <PanelRightClose /> : <PanelRightOpen />}
            onClick={toggleDock}
            tooltipSide="bottom"
          />
        )}
      </div>
    </div>
  );
}

const SHOW_AFTER_MS = 4000;

/** Says so when live updates stop, so a quiet page is never mistaken for a factory with nothing to do. */
export function ConnectionBanner({ connected }: { connected: boolean }) {
  const [show, setShow] = useState(false);
  const health = useHealth();
  useEffect(() => {
    if (connected) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [connected]);
  if (!show) return null;
  const down = health.isError;
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-tone-warn-line bg-tone-warn-fill dark:bg-tone-warn-fill/40 px-4 py-2 text-sm">
      {down ? <WifiOff className="size-4 text-ink-warn" /> : <RefreshCw className="size-4 animate-spin text-ink-warn [animation-duration:2s]" />}
      <span className="font-medium text-ink">{down ? 'The factory server is not responding.' : 'Reconnecting to the factory server…'}</span>
      <span className="text-ink-secondary">
        {down ? 'Check that it is running with pnpm service status.' : 'Live updates are paused, so what you see may be out of date.'}
      </span>
      <Button size="xs" variant="outline" className="ml-auto" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
