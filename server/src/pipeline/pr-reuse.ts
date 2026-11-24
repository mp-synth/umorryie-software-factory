import fs from 'node:fs';
import path from 'node:path';

/** The open PR a rebuilt ticket keeps: its number and the remote branch the rebuilt code is pushed to. */
export interface ReusedPr {
  prNumber: number;
  prUrl: string | null;
  branch: string;
}

/**
 * What survives a ticket's reset, kept in the initiative folder (the ticket folder is wiped on reset).
 * `builds` counts every build of the ticket, so the rebuild limit holds although a rebuilt ticket keeps
 * its branch name; `reuse` is the PR its next push goes to, until that push lands.
 */
export interface RebuildState {
  builds: number;
  reuse: ReusedPr | null;
}

export function readRebuildState(file: string): RebuildState {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RebuildState>;
    return { builds: Number.isInteger(raw.builds) && raw.builds! > 0 ? raw.builds! : 1, reuse: raw.reuse?.branch && raw.reuse.prNumber ? raw.reuse : null };
  } catch {
    return { builds: 1, reuse: null };
  }
}

export function writeRebuildState(file: string, state: RebuildState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

/** A reset starts the next build; an open PR on the ticket's own branch is kept for it. */
export function stateAfterReset(before: RebuildState, ticket: { prNumber: number | null; prUrl: string | null; prState: string | null; branch: string | null; prHeadRef?: string | null }): RebuildState {
  const keep = !!ticket.prNumber && ticket.prState === 'OPEN' && !!ticket.branch && !ticket.prHeadRef;
  return {
    builds: before.builds + 1,
    reuse: keep ? { prNumber: ticket.prNumber!, prUrl: ticket.prUrl, branch: ticket.branch! } : before.reuse,
  };
}
