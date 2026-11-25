import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Crumb } from '@/components/ui';

interface PageMeta {
  title: string;
  crumbs: Crumb[];
}

const Ctx = createContext<{ meta: PageMeta; setMeta: (m: PageMeta) => void } | null>(null);

export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<PageMeta>({ title: '', crumbs: [] });
  const value = useMemo(() => ({ meta, setMeta }), [meta]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePageMetaValue = (): PageMeta => useContext(Ctx)?.meta ?? { title: '', crumbs: [] };

/** Names the page in the top bar's breadcrumbs and in the browser tab. The last crumb is the page itself. */
export function usePageMeta(title: string, parents: Crumb[] = []): void {
  const setMeta = useContext(Ctx)?.setMeta;
  const key = JSON.stringify([title, parents.map((p) => [String(p.label), p.to])]);
  useEffect(() => {
    setMeta?.({ title, crumbs: [...parents, { label: title }] });
  }, [key, setMeta]);
}
