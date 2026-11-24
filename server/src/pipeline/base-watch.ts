// When a PR merges, the base branch moves and other open PRs can start to conflict with it.
// The regular sweep runs every 15 minutes; watching the base branches lets the factory
// sweep a repo's open PRs a minute after its base moved instead.

/** How often the base branches of open PRs are checked on GitHub (one `git ls-remote` per repo). */
export const BASE_WATCH_MS = 60_000;
/** GitHub works out mergeability after the base moves; the sweep waits this long for it. */
export const SWEEP_AFTER_BASE_MOVE_MS = 60_000;
/** A PR whose mergeability GitHub has not worked out yet is looked at again after this long. */
export const MERGEABILITY_RECHECK_MS = 45_000;
export const MERGEABILITY_RECHECKS = 3;

/** Remembers each base branch's last head; reports a move, never the first sighting. */
export class BaseHeads {
  private seen = new Map<string, string>();

  /** The branches of one repo whose head changed since the last look. */
  moved(repo: string, heads: Map<string, string>): string[] {
    const moved: string[] = [];
    for (const [branch, sha] of heads) {
      const key = `${repo}\u0000${branch}`;
      const before = this.seen.get(key);
      this.seen.set(key, sha);
      if (before !== undefined && before !== sha) moved.push(branch);
    }
    return moved;
  }
}

/** Parses `git ls-remote origin refs/heads/a refs/heads/b` into branch → sha. */
export function parseLsRemote(stdout: string): Map<string, string> {
  const heads = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{40})\s+refs\/heads\/(.+)$/);
    if (m) heads.set(m[2], m[1]);
  }
  return heads;
}

/**
 * Counts re-checks of a PR whose mergeability GitHub reports as UNKNOWN, per head commit, so
 * a PR GitHub never decides on is not polled forever. A known answer clears the count.
 */
export class MergeabilityRechecks {
  private tries = new Map<string, { head: string; n: number }>();

  constructor(private readonly max = MERGEABILITY_RECHECKS) {}

  /** Whether to look again; call it only while the answer is UNKNOWN. */
  another(ticketId: string, head: string): boolean {
    const t = this.tries.get(ticketId);
    const n = t && t.head === head ? t.n + 1 : 1;
    this.tries.set(ticketId, { head, n });
    return n <= this.max;
  }

  known(ticketId: string): void {
    this.tries.delete(ticketId);
  }
}
