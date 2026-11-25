import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { RunDock } from '@/components/dock/RunDock';
import { ConfirmHost } from '@/components/ui';
import { useAttentionSignals } from '@/lib/attention';
import { useLiveUpdates } from '@/lib/live';
import { useResolvedMode } from '@/lib/preferences';
import { useAppActions } from './app-actions';
import { AppActionsProvider } from './AppActionsProvider';
import { PageMetaProvider, usePageMetaValue } from './page-meta';
import { Sidebar } from './Sidebar';
import { ConnectionBanner, TopBar } from './TopBar';

/** Inset panels on the window backdrop: the sidebar, the page, and the live agents panel beside it. */
export function AppShell() {
  return (
    <PageMetaProvider>
      <AppActionsProvider>
        <Frame />
      </AppActionsProvider>
    </PageMetaProvider>
  );
}

function Frame() {
  const connected = useLiveUpdates();
  const actions = useAppActions();
  const { title } = usePageMetaValue();
  useAttentionSignals(title);
  const { pathname } = useLocation();
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm focus:shadow-popover"
      >
        Skip to content
      </a>
      <div className="relative flex h-full gap-2 p-2">
        <Sidebar connected={connected} onCreate={actions.newInitiative} onSearch={actions.openSearch} onHelp={actions.openShortcuts} />
        <main id="main" tabIndex={-1} className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line-subtle bg-panel shadow-sm outline-none [container:page/inline-size]">
          <TopBar onSearch={actions.openSearch} />
          <ConnectionBanner connected={connected} />
          <div ref={scroller} className="scroll-area min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </main>
        <RunDock />
      </div>
      <ThemedToaster />
      <ConfirmHost />
    </>
  );
}

function ThemedToaster() {
  const mode = useResolvedMode();
  return (
    <Toaster
      theme={mode}
      position="bottom-right"
      gap={8}
      toastOptions={{
        classNames: {
          toast: '!rounded-xl !border !border-line-subtle !bg-raised !font-sans !text-sm !text-ink !shadow-popover',
          description: '!text-ink-secondary',
          actionButton: '!bg-primary !text-ink-on-primary',
          cancelButton: '!bg-neutral-subtle !text-ink',
          success: '[&_[data-icon]]:!text-ink-good',
          error: '[&_[data-icon]]:!text-ink-bad',
          warning: '[&_[data-icon]]:!text-ink-warn',
          info: '[&_[data-icon]]:!text-ink-accent',
        },
      }}
    />
  );
}
