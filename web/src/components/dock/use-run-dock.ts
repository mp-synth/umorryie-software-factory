import { useSearchParams } from 'react-router-dom';
import { layout } from '@/lib/layout';

/** `?run=<id>` opens one run's details in the live panel; without it an initiative page shows every agent's activity. */
export function useRunDock() {
  const [params, setParams] = useSearchParams();
  const setRun = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('run', id);
    else next.delete('run');
    setParams(next);
  };
  return {
    runId: params.get('run'),
    watch: (id: string) => {
      layout.set({ dockOpen: true });
      setRun(id);
    },
    back: () => setRun(null),
  };
}
