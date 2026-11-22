import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CapacityStatus, ChangeEvent, RunEvent } from '@factory/shared';
import { api } from './api';

const DEAD_STREAM_SILENCE_MS = 25_000;
const TAB_FOCUS_SILENCE_MS = 12_000;
const WATCHDOG_INTERVAL_MS = 5_000;

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
  const reopenIfSilentFor = (maxSilence: number) => {
    if (es && Date.now() - lastSeen > maxSilence) reopen();
  };
  const watchdog = setInterval(() => reopenIfSilentFor(DEAD_STREAM_SILENCE_MS), WATCHDOG_INTERVAL_MS);
  const onVisible = () => document.visibilityState === 'visible' && reopenIfSilentFor(TAB_FOCUS_SILENCE_MS);
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
    let missedChangesWhileDisconnected = false;
    const stop = openStream(
      () => '/api/stream',
      (es) => es.addEventListener('change', onChange),
      (open) => {
        setConnected(open);
        if (open && wasOpen === false && missedChangesWhileDisconnected) qc.invalidateQueries();
        if (!open) missedChangesWhileDisconnected = true;
        wasOpen = open;
      },
    );
    function onChange(msg: Event) {
      const e = JSON.parse((msg as MessageEvent).data) as ChangeEvent;
      if (e.initiativeId) queue(['initiative', e.initiativeId]);
      if (e.type === 'run') {
        queue(['runs']);
        queue(['run', e.id]);
        queue(['capacity']);
      }
      if (e.type === 'project') queue(['projects']);
      if (e.type === 'settings') {
        queue(['settings']);
        queue(['capacity']);
      }
      if (e.type !== 'message') queue(['initiatives']);
    }
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [qc]);
  return connected;
}

const CAPACITY_REFRESH_MS = 5000;

export function useCapacity(): CapacityStatus | undefined {
  const serverKnowsCapacity = (failed: boolean) => (failed ? false : CAPACITY_REFRESH_MS);
  return useQuery({
    queryKey: ['capacity'],
    queryFn: api.capacity,
    retry: false,
    refetchInterval: (query) => serverKnowsCapacity(query.state.status === 'error'),
  }).data;
}

export function poolSize(c: CapacityStatus): string {
  const guaranteed = c.running - c.limit;
  return guaranteed > 0 ? `pool of ${c.limit} + ${guaranteed} guaranteed` : `pool of ${c.limit}`;
}

export function poolNote(c: CapacityStatus): string | null {
  if (!c.autoScale || c.pressure === 'ok' || c.limit >= c.ceiling) return null;
  return `held at ${c.limit} of ${c.ceiling} while this machine is short on ${c.pressure === 'memory' ? 'memory' : 'CPU'}`;
}

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

export function useNow(ms = 1000, enabled = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
  return now;
}
