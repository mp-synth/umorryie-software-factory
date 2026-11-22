export interface FairLimiter {
  run<T>(lane: string, work: () => Promise<T>, onWait?: () => void): Promise<T>;
}

interface Waiter {
  lane: string;
  start: () => void;
}

export function fairLimiter(size: () => number): FairLimiter {
  const activePerLane = new Map<string, number>();
  const waiting: Waiter[] = [];
  let active = 0;
  const load = (lane: string) => activePerLane.get(lane) ?? 0;

  const startWaiting = () => {
    while (waiting.length && active < size()) {
      let leastLoaded = 0;
      waiting.forEach((w, i) => {
        if (load(w.lane) < load(waiting[leastLoaded].lane)) leastLoaded = i;
      });
      const [next] = waiting.splice(leastLoaded, 1);
      active++;
      activePerLane.set(next.lane, load(next.lane) + 1);
      next.start();
    }
  };

  const release = (lane: string) => {
    active--;
    if (load(lane) > 1) activePerLane.set(lane, load(lane) - 1);
    else activePerLane.delete(lane);
    startWaiting();
  };

  return {
    async run(lane, work, onWait) {
      let started = false;
      const turn = new Promise<void>((resolve) => {
        waiting.push({
          lane,
          start: () => {
            started = true;
            resolve();
          },
        });
      });
      startWaiting();
      if (!started) onWait?.();
      await turn;
      try {
        return await work();
      } finally {
        release(lane);
      }
    },
  };
}
