import { monitorEventLoopDelay } from 'node:perf_hooks';

const SAMPLE_MS = 30_000;
const SLOW_MS = 500;

/** Reports when the event loop stalls, so a synchronous call blocking every agent's bookkeeping shows up in the log. */
export function watchEventLoop(): void {
  const delay = monitorEventLoopDelay({ resolution: 50 });
  delay.enable();
  setInterval(() => {
    const worst = delay.max / 1e6;
    if (worst > SLOW_MS) console.warn(`[event-loop] blocked for up to ${Math.round(worst)} ms in the last ${SAMPLE_MS / 1000} s (p99 ${Math.round(delay.percentile(99) / 1e6)} ms)`);
    delay.reset();
  }, SAMPLE_MS).unref();
}

/** Prefixes every log line with the time, so incidents can be told apart in server.log. */
export function stampConsole(): void {
  for (const level of ['log', 'warn', 'error'] as const) {
    const write = console[level].bind(console);
    console[level] = (...args: unknown[]) => write(new Date().toISOString(), ...args);
  }
}
