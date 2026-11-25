import { AlertOctagon, Compass, RotateCw } from 'lucide-react';
import { useRouteError } from 'react-router-dom';
import { usePageMeta } from '@/components/shell/page-meta';
import { Button, ButtonLink, EmptyState, Page } from '@/components/ui';

export function NotFoundPage() {
  usePageMeta('Not found');
  return (
    <Page width="narrow">
      <EmptyState
        icon={<Compass />}
        title="There is nothing at this address"
        actions={
          <ButtonLink to="/" variant="primary">
            Go to the overview
          </ButtonLink>
        }
      >
        The link may be old, or the initiative it pointed to was deleted. Search with ⌘K, or start from the overview.
      </EmptyState>
    </Page>
  );
}

function Crash() {
  const error = useRouteError() as Error | undefined;
  return (
    <EmptyState
      icon={<AlertOctagon className="text-ink-bad" />}
      title="This page crashed"
      actions={
        <>
          <Button variant="primary" icon={<RotateCw />} onClick={() => window.location.reload()}>
            Reload
          </Button>
          <a href="/">
            <Button variant="outline">Go to the overview</Button>
          </a>
        </>
      }
    >
      Nothing in the factory stopped: agents keep running on the server. Reloading usually fixes this.
      {error?.message && <code className="mt-3 block break-words rounded-md bg-sunken px-3 py-2 text-left text-xs text-ink-secondary">{error.message}</code>}
      {error?.stack && (
        <details className="mt-2 text-left">
          <summary className="cursor-pointer text-xs text-ink-tertiary hover:text-ink">Technical details</summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-sunken px-3 py-2 font-mono text-2xs text-ink-secondary">{error.stack}</pre>
        </details>
      )}
    </EmptyState>
  );
}

/** A page that crashed, inside the shell: the sidebar and everything else keep working. */
export function PageCrash() {
  usePageMeta('Something went wrong');
  return (
    <Page width="narrow">
      <Crash />
    </Page>
  );
}

/** The whole app crashed: never leave a blank window. */
export function AppCrash() {
  return (
    <div className="grid h-full place-items-center bg-backdrop p-6">
      <div className="w-full max-w-lg rounded-2xl border border-line-subtle bg-panel shadow-dialog">
        <Crash />
      </div>
    </div>
  );
}
