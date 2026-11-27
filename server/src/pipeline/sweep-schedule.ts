/**
 * Keeps early PR sweeps (base moved, CI settled red, mergeability unknown) from piling up or getting
 * lost: at most one timer waits per key, and a sweep asked for while one runs runs once more after it.
 */
export class SweepSchedule {
  private timers = new Map<string, { at: number; timer: NodeJS.Timeout }>();
  private running = new Map<string, { again: boolean; manual: boolean }>();

  /** Runs `run` after `delayMs`, unless a run for `key` is already due as soon or sooner. */
  schedule(key: string, delayMs: number, run: () => Promise<unknown>, now = Date.now()): void {
    const at = now + delayMs;
    const waiting = this.timers.get(key);
    if (waiting && waiting.at <= at) return;
    if (waiting) clearTimeout(waiting.timer);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      run().catch((err) => console.error('[pr-sweep]', err));
    }, delayMs);
    timer.unref();
    this.timers.set(key, { at, timer });
  }

  /** Starts a pass over `key`; false while one runs, which then owes another pass when it ends. */
  begin(key: string, manual = false): boolean {
    const pass = this.running.get(key);
    if (!pass) {
      this.running.set(key, { again: false, manual: false });
      return true;
    }
    pass.again = true;
    pass.manual ||= manual;
    return false;
  }

  /** Ends the pass over `key`; returns the pass asked for meanwhile, if any. */
  end(key: string): { manual: boolean } | null {
    const pass = this.running.get(key);
    this.running.delete(key);
    return pass?.again ? { manual: pass.manual } : null;
  }
}

interface CoalescedState {
  again: boolean;
  promise: Promise<boolean>;
}

export class CoalescedRun {
  private readonly running = new Map<string, CoalescedState>();

  run(key: string, work: () => Promise<boolean>): Promise<boolean> {
    const active = this.running.get(key);
    if (active) {
      active.again = true;
      return active.promise;
    }
    const state: CoalescedState = { again: false, promise: Promise.resolve(true) };
    state.promise = Promise.resolve().then(async () => {
      try {
        let succeeded = false;
        do {
          state.again = false;
          succeeded = await work();
        } while (state.again);
        return succeeded;
      } finally {
        if (this.running.get(key) === state) this.running.delete(key);
      }
    });
    this.running.set(key, state);
    return state.promise;
  }
}
