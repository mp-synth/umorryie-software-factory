import { useEffect, useState } from 'react';
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
    for (const type of ['hello', 'change', 'run', 'run-ready', 'ping']) es.addEventListener(type, () => (lastSeen = Date.now()));
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

// The tab's one live connection. Browsers allow six HTTP/1.1 connections per
// host, so a stream per watched run (four running agents in the side panel)
// stalled every other request, other tabs included. Changes and the events of
// every watched run share /api/stream; the tab names its runs by the stream id
// the server sends in `hello`, and names them all again after a reconnect.

interface WatchedRun {
  events: RunEvent[];
  ready: boolean;
  last: number;
  listeners: Set<() => void>;
}

const watched = new Map<string, WatchedRun>();
const changeListeners = new Set<(e: ChangeEvent) => void>();
const stateListeners = new Set<(open: boolean) => void>();
const toWatch = new Set<string>();
const toUnwatch = new Set<string>();
let streamId: string | null = null;
let streamOpen = false;
let stopStream: (() => void) | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

const data = (msg: Event) => JSON.parse((msg as MessageEvent).data);

function ensureStream(): void {
  if (stopStream) return;
  stopStream = openStream(
    () => '/api/stream',
    (es) => {
      es.addEventListener('hello', (msg) => {
        streamId = data(msg).id;
        toUnwatch.clear();
        for (const runId of watched.keys()) toWatch.add(runId);
        scheduleSync(0);
      });
      es.addEventListener('change', (msg) => {
        const e = data(msg) as ChangeEvent;
        for (const l of changeListeners) l(e);
      });
      es.addEventListener('run', (msg) => {
        const e = data(msg) as RunEvent;
        const w = watched.get(e.runId);
        if (!w || Number(e.id) <= w.last) return;
        w.last = Number(e.id);
        w.events.push(e);
        for (const l of w.listeners) l();
      });
      es.addEventListener('run-ready', (msg) => {
        const w = watched.get(data(msg).runId);
        if (!w || w.ready) return;
        w.ready = true;
        for (const l of w.listeners) l();
      });
    },
    (open) => {
      streamOpen = open;
      if (!open) streamId = null;
      for (const l of stateListeners) l(open);
    },
  );
}

function closeStreamIfUnused(): void {
  if (!stopStream || changeListeners.size || stateListeners.size || watched.size) return;
  stopStream();
  stopStream = null;
  streamId = null;
  streamOpen = false;
}

function scheduleSync(delay: number): void {
  if (!syncTimer) syncTimer = setTimeout(syncWatches, delay);
}

let syncing = false;

// One update at a time, so an unwatch and a later watch of the same run never
// reach the server in the wrong order.
async function syncWatches(): Promise<void> {
  syncTimer = null;
  const sid = streamId;
  if (!sid || syncing) return; // the next hello, or the update in flight, picks these up
  const watch = [...toWatch].filter((runId) => watched.has(runId)).map((runId) => ({ id: runId, after: watched.get(runId)!.last }));
  const unwatch = [...toUnwatch].filter((runId) => !watched.has(runId));
  toWatch.clear();
  toUnwatch.clear();
  if (!watch.length && !unwatch.length) return;
  syncing = true;
  let retry = false;
  try {
    await api.liveRuns(sid, { watch, unwatch });
  } catch {
    if (streamId === sid) {
      for (const w of watch) toWatch.add(w.id);
      for (const runId of unwatch) toUnwatch.add(runId);
      retry = true;
    } // else it reconnected meanwhile, and its hello names every watched run
  } finally {
    syncing = false;
  }
  if (toWatch.size || toUnwatch.size) scheduleSync(retry ? 2000 : 0);
}

function watchRun(runId: string, listener: () => void): () => void {
  let w = watched.get(runId);
  if (!w) {
    w = { events: [], ready: false, last: 0, listeners: new Set() };
    watched.set(runId, w);
    toUnwatch.delete(runId);
    toWatch.add(runId);
    ensureStream();
    scheduleSync(0);
  }
  const run = w;
  run.listeners.add(listener);
  return () => {
    run.listeners.delete(listener);
    if (run.listeners.size || watched.get(runId) !== run) return;
    watched.delete(runId);
    toWatch.delete(runId);
    toUnwatch.add(runId);
    scheduleSync(0);
    closeStreamIfUnused();
  };
}

function onLive(onChange: (e: ChangeEvent) => void, onState: (open: boolean) => void): () => void {
  changeListeners.add(onChange);
  stateListeners.add(onState);
  ensureStream();
  if (streamOpen) onState(true);
  return () => {
    changeListeners.delete(onChange);
    stateListeners.delete(onState);
    closeStreamIfUnused();
  };
}

import.meta.hot?.dispose(() => {
  stopStream?.();
  stopStream = null;
});

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
    const stop = onLive(onChange, (open) => {
      setConnected(open);
      if (open && wasOpen === false && missedChangesWhileDisconnected) qc.invalidateQueries();
      if (!open) missedChangesWhileDisconnected = true;
      wasOpen = open;
    });
    function onChange(e: ChangeEvent) {
      if (e.initiativeId) queue(['initiative', e.initiativeId]);
      if (e.type === 'run') {
        queue(['runs']);
        queue(['run', e.id]);
        queue(['capacity']);
      }
      if (e.type === 'project') queue(['projects']);
      if (e.type === 'usage') queue(['usage']);
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

const NO_EVENTS: { events: RunEvent[]; ready: boolean } = { events: [], ready: false };

export function useRunEvents(runId: string | null): { events: RunEvent[]; ready: boolean } {
  const [state, setState] = useState(NO_EVENTS);
  useEffect(() => {
    setState(NO_EVENTS);
    if (!runId) return;
    let raf = 0;
    const show = () => {
      raf = 0;
      const w = watched.get(runId);
      if (w) setState({ events: w.events.slice(), ready: w.ready });
    };
    const release = watchRun(runId, () => {
      if (!raf) raf = requestAnimationFrame(show);
    });
    const w = watched.get(runId);
    if (w && (w.events.length || w.ready)) show(); // another panel already watches this run
    return () => {
      release();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [runId]);
  return state;
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
