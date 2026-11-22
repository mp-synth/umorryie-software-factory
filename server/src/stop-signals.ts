// tsx, pnpm and concurrently pass the terminal's Ctrl-C on to the server again, so one press arrives as two signals a few milliseconds apart.
const COPIES_OF_ONE_STOP_MS = 1000;

export type StopSignal = 'stop' | 'copy-of-the-stop' | 'stop-now';

export function stopSignals(now: () => number = Date.now): () => StopSignal {
  let firstAt: number | null = null;
  return () => {
    const at = now();
    if (firstAt === null) {
      firstAt = at;
      return 'stop';
    }
    return at - firstAt <= COPIES_OF_ONE_STOP_MS ? 'copy-of-the-stop' : 'stop-now';
  };
}
