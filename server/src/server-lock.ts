import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';

const SERVER_LOCK_KEY = 43170001;
const RETAKE_PAUSE_MS = 1000;

export type ServerLock = { release: () => Promise<void> };

export function databaseLabel(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `${decodeURIComponent(url.pathname.slice(1))} on ${url.host}`;
}

export function lockHeldMessage(databaseUrl: string): string {
  return `Another factory server is already running on this database (${databaseLabel(databaseUrl)}). Stop it first, or point DATABASE_URL at another database.`;
}

export async function retake(attempt: () => Promise<boolean>, pause: () => Promise<void>): Promise<boolean> {
  for (;;) {
    const taken = await attempt().catch(() => null);
    if (taken !== null) return taken;
    await pause();
  }
}

export async function takeServerLock(databaseUrl: string, onLost: () => void): Promise<ServerLock | null> {
  let holding = false;
  const released = new AbortController();

  const retakeAfterDrop = async () => {
    holding = false;
    console.warn('[server] the connection that holds the one-server-per-database lock dropped; taking the lock again');
    holding = await retake(attempt, () => delay(RETAKE_PAUSE_MS, undefined, { signal: released.signal }));
    if (!holding) return onLost();
    console.warn('[server] holding the one-server-per-database lock again');
  };

  const connection = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 0,
    max_lifetime: null,
    fetch_types: false,
    onnotice: () => {},
    onclose: () => {
      if (holding) retakeAfterDrop().catch(() => {});
    },
  });

  async function attempt(): Promise<boolean> {
    const [row] = await connection<{ taken: boolean }[]>`select pg_try_advisory_lock(${SERVER_LOCK_KEY}) as taken`;
    return row?.taken === true;
  }

  async function release(): Promise<void> {
    holding = false;
    released.abort();
    await connection.end({ timeout: 2 });
  }

  try {
    holding = await attempt();
  } finally {
    if (!holding) await connection.end({ timeout: 2 });
  }
  return holding ? { release } : null;
}
