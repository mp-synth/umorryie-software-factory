export interface FairLimiter {
  /** Runs `work` once `weight` of the capacity is free, the least loaded lane first. */
  run<T>(lane: string, work: () => Promise<T>, onWait?: () => void, weight?: number): Promise<T>;
}

interface Waiter {
  lane: string;
  weight: number;
  start: () => void;
}

export function fairLimiter(size: () => number): FairLimiter {
  const activePerLane = new Map<string, number>();
  const waiting: Waiter[] = [];
  let active = 0;
  const load = (lane: string) => activePerLane.get(lane) ?? 0;
  // Heavier than the whole capacity still runs, alone, instead of waiting forever.
  const fits = (w: Waiter) => active === 0 || active + Math.min(w.weight, size()) <= size();

  const startWaiting = () => {
    for (;;) {
      let leastLoaded = -1;
      waiting.forEach((w, i) => {
        if (fits(w) && (leastLoaded < 0 || load(w.lane) < load(waiting[leastLoaded].lane))) leastLoaded = i;
      });
      if (leastLoaded < 0) return;
      const next = waiting[leastLoaded];
      waiting.splice(leastLoaded, 1);
      active += next.weight;
      activePerLane.set(next.lane, load(next.lane) + 1);
      next.start();
    }
  };

  const release = (lane: string, weight: number) => {
    active -= weight;
    if (load(lane) > 1) activePerLane.set(lane, load(lane) - 1);
    else activePerLane.delete(lane);
    startWaiting();
  };

  return {
    async run(lane, work, onWait, weight = 1) {
      let started = false;
      const turn = new Promise<void>((resolve) => {
        waiting.push({
          lane,
          weight,
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
        release(lane, weight);
      }
    },
  };
}

export interface SlotReservation {
  readonly slot: number;
  release(): void;
}

export interface SlotPool {
  with<T>(work: (slot: number) => Promise<T>): Promise<T>;
  /** Synchronously reserves a recovered slot before new scheduled work can take it. */
  reserve(slot: number): SlotReservation;
  /** Reserves a known slot for the duration of recovered work. */
  holding<T>(slot: number, work: () => Promise<T>): Promise<T>;
}

/** Numbered slots (1..size) for work that must not share a resource, such as a test database index. */
export function slotPool(size: number): SlotPool {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('slot pool size must be a positive integer');
  const taken = new Set<number>();
  const waiters: ((slot: number) => void)[] = [];
  const validate = (slot: number) => {
    if (!Number.isInteger(slot) || slot < 1 || slot > size) throw new RangeError(`slot must be an integer from 1 to ${size}`);
  };
  const take = (): number | null => {
    for (let n = 1; n <= size; n++) {
      if (!taken.has(n)) {
        taken.add(n);
        return n;
      }
    }
    return null;
  };
  const release = (slot: number) => {
    const next = waiters.shift();
    if (next) next(slot);
    else taken.delete(slot);
  };
  const reserve = (slot: number): SlotReservation => {
    validate(slot);
    if (taken.has(slot)) throw new Error(`slot ${slot} is already owned`);
    taken.add(slot);
    let held = true;
    return {
      slot,
      release() {
        if (!held) return;
        held = false;
        release(slot);
      },
    };
  };
  return {
    async with<T>(work: (slot: number) => Promise<T>): Promise<T> {
      const slot = take() ?? (await new Promise<number>((resolve) => waiters.push(resolve)));
      try {
        return await work(slot);
      } finally {
        release(slot);
      }
    },
    reserve,
    async holding<T>(slot: number, work: () => Promise<T>): Promise<T> {
      const reservation = reserve(slot);
      try {
        return await work();
      } finally {
        reservation.release();
      }
    },
  };
}
