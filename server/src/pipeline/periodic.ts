export interface PeriodicJob {
  /** Runs the job now unless it is already running; resolves when this call's run (or the running one) ends. */
  now(): Promise<void>;
}

/**
 * A job that runs every `everyMs` and never overlaps itself: a run still going when the next is due is left to
 * finish, and a run going longer than `warnAfterMs` is reported once, so a hung `gh` or `git` call shows up in
 * the log instead of silently stopping the job.
 */
export function periodic(name: string, everyMs: number, job: () => Promise<void>, opts: { firstAfterMs?: number; warnAfterMs?: number } = {}): PeriodicJob {
  let running: Promise<void> | null = null;
  let startedAt = 0;
  let warned = false;
  const warnAfter = opts.warnAfterMs ?? Math.max(everyMs * 3, 5 * 60_000);
  const now = (): Promise<void> => {
    if (running) {
      if (!warned && Date.now() - startedAt > warnAfter) {
        warned = true;
        console.warn(`[${name}] still running after ${Math.round((Date.now() - startedAt) / 1000)} s; later runs wait for it`);
      }
      return running;
    }
    startedAt = Date.now();
    warned = false;
    running = job()
      .catch((err) => console.error(`[${name}]`, err))
      .finally(() => {
        running = null;
      });
    return running;
  };
  setInterval(() => void now(), everyMs).unref();
  if (opts.firstAfterMs !== undefined) setTimeout(() => void now(), opts.firstAfterMs).unref();
  return { now };
}
