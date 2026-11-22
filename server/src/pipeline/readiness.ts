import type { Ticket } from '@factory/shared';

type Dependency = Pick<Ticket, 'status' | 'prNumber' | 'prState' | 'ciState'>;

export function dependencyReady(dep: Dependency, waitForCi: boolean): boolean {
  if (!['approved', 'merged'].includes(dep.status)) return false;
  if (!waitForCi || dep.status === 'merged' || !dep.prNumber || dep.prState !== 'OPEN') return true;
  return dep.ciState === 'green' || dep.ciState === 'none';
}
