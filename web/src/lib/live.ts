import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChangeEvent, RunEvent } from '@factory/shared';

/**
 * EventSource that survives server restarts. The browser only retries on its
 * own after a dropped connection; an error *status* (e.g. the dev proxy's 502
 * while the server restarts) closes it for good, so we reopen it ourselves.
 */
function openStream(url: () => string, setup: (es: EventSource) => void, onState?: (open: boolean) => void): () => void {
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let delay = 1000;
  let lastSeen = Date.now();
  const reopen = () => {
    es?.close();
    es = null;
    onState?.(false);
    if (timer) clearTimeout(timer);
    timer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 15_000);
  };
  // The server pings every 10s. A proxy can keep a dead stream "open" forever, so silence means reconnect.
  const check = (maxSilence: number) => {
    if (es && Date.now() - lastSeen > maxSilence) reopen();
  };
  const watchdog = setInterval(() => check(25_000), 5_000);
  // Coming back to the tab: don't wait for the next tick.
  const onVisible = () => document.visibilityState === 'visible' && check(12_000);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  const connect = () => {
    if (closed) return;
    lastSeen = Date.now();
    es = new EventSource(url());
    es.onmessage = () => (lastSeen = Date.now());
    es.onopen = () => {
      lastSeen = Date.now();
      delay = 1000;
      onState?.(true);
    };
    es.onerror = () => {
      onState?.(false);
      if (es && es.readyState === EventSource.CLOSED) reopen();
    };
    setup(es);
    for (const type of ['change', 'event', 'ready', 'ping']) es.addEventListener(type, () => (lastSeen = Date.now()));
  };
  connect();
  return () => {
    closed = true;
    clearInterval(watchdog);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    if (timer) clearTimeout(timer);
    es?.close();
  };
}

/** One EventSource for the whole app: entity changes invalidate the matching queries. */
export function useLiveUpdates(): boolean {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      const keys = pending;
      pending = new Set();
      timer = null;
      for (const k of keys) qc.invalidateQueries({ queryKey: JSON.parse(k) });
    };
    const queue = (key: unknown[]) => {
      pending.add(JSON.stringify(key));
      if (!timer) timer = setTimeout(flush, 120);
    };
    let wasOpen = false;
    let pendingResync = false;
    const stop = openStream(
      () => '/api/stream',
      (es) => es.addEventListener('change', onChange),
      (open) => {
        setConnected(open);
        // After a reconnect we may have missed changes: refresh everything once.
        if (open && wasOpen === false && pendingResync) qc.invalidateQueries();
        if (!open) pendingResync = true;
        wasOpen = open;
      },
    );
    function onChange(msg: Event) {
      const e = JSON.parse((msg as MessageEvent).data) as ChangeEvent;
      if (e.initiativeId) queue(['initiative', e.initiativeId]);
      if (e.type === 'run') {
        queue(['runs']);
        queue(['run', e.id]);
      }
      if (e.type === 'project') queue(['projects']);
      if (e.type === 'settings') queue(['settings']);
      if (e.type !== 'message') queue(['initiatives']);
    }
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [qc]);
  return connected;
}

/** Streams a run's events: replays history, then follows live. */
export function useRunEvents(runId: string | null): { events: RunEvent[]; ready: boolean } {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [ready, setReady] = useState(false);
  const lastId = useRef(0);
  useEffect(() => {
    setEvents([]);
    setReady(false);
    lastId.current = 0;
    if (!runId) return;
    let buffer: RunEvent[] = [];
    let raf = 0;
    const flush = () => {
      raf = 0;
      const batch = buffer;
      buffer = [];
      setEvents((prev) => prev.concat(batch));
    };
    const stop = openStream(
      // Resume after the last event we have, so a reconnect never duplicates lines.
      () => `/api/runs/${runId}/stream?after=${lastId.current}`,
      (es) => {
        es.addEventListener('event', (msg) => {
          const e = JSON.parse((msg as MessageEvent).data) as RunEvent;
          if (Number(e.id) <= lastId.current) return;
          lastId.current = Number(e.id);
          buffer.push(e);
          if (!raf) raf = requestAnimationFrame(flush);
        });
        es.addEventListener('ready', () => setReady(true));
      },
    );
    return () => {
      stop();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [runId]);
  return { events, ready };
}

/** Re-renders every `ms` so durations tick. */
export function useNow(ms = 1000, enabled = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
  return now;
}
