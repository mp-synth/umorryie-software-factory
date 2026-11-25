import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Rule } from '@factory/shared';
import { api } from './api';
import { inboxItems } from './initiative';

export const useInitiatives = () => useQuery({ queryKey: ['initiatives'], queryFn: api.initiatives });

export const useInitiative = (id: string | null | undefined) =>
  useQuery({ queryKey: ['initiative', id], queryFn: () => api.initiative(id!), enabled: !!id });

export const useActiveRuns = () => useQuery({ queryKey: ['runs', 'active'], queryFn: () => api.runs({ active: true }), refetchInterval: 15_000 });

export const useProjects = (enabled = true) => useQuery({ queryKey: ['projects'], queryFn: api.projects, enabled });

export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 30_000, refetchInterval: 30_000, retry: false });

function useProposedRules(): Rule[] {
  const { data: projects = [] } = useProjects();
  const results = useQueries({ queries: projects.map((p) => ({ queryKey: ['projects', p.id, 'rules'], queryFn: () => api.projectRules(p.id), retry: false })) });
  return results.flatMap((q) => q.data ?? []).filter((r) => r.status === 'proposed');
}

/** Everything that waits on the user: decisions on initiatives, and rules retros proposed. */
export function useInbox() {
  const initiatives = useInitiatives();
  const rules = useProposedRules();
  const items = useMemo(() => inboxItems(initiatives.data ?? []), [initiatives.data]);
  return { items, rules, total: items.length + rules.length, isLoading: initiatives.isLoading };
}
