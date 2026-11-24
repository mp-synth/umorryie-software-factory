import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { ChangeEvent, RunEvent } from '@factory/shared';

export type Send = (event: string, data: unknown) => void;

export interface LiveStream {
  id: string;
  /** Replays the run's events after `after`, then sends new ones as they happen. */
  watch(runId: string, after: number): Promise<void>;
  unwatch(runId: string): void;
  close(): void;
}

/**
 * One live connection per browser tab: every change event, plus the events of
 * the runs that tab watches. Browsers allow six HTTP/1.1 connections per host,
 * so a stream per watched run left a tab with four running agents unable to
 * load anything else.
 *
 * The stream opens with `hello {id}`; the tab then names the runs it watches by
 * that id. Run events arrive as `run` (a RunEvent), and `run-ready {runId, last}`
 * marks the end of a run's replay.
 */
export function liveHub(bus: EventEmitter, listRunEvents: (runId: string, after: number) => Promise<RunEvent[]>) {
  const streams = new Map<string, LiveStream>();

  function open(send: Send): LiveStream {
    const id = randomUUID();
    const runs = new Map<string, () => void>();
    const onChange = (e: ChangeEvent) => send('change', e);
    bus.on('change', onChange);

    async function watch(runId: string, after: number): Promise<void> {
      runs.get(runId)?.();
      let last = after;
      let replaying = true;
      let stopped = false;
      const buffer: RunEvent[] = [];
      const deliver = (e: RunEvent) => {
        if (Number(e.id) <= last) return;
        last = Number(e.id);
        send('run', e);
      };
      const onEvent = (e: RunEvent) => {
        if (replaying) buffer.push(e);
        else deliver(e);
      };
      const stop = () => {
        stopped = true;
        bus.off(`run:${runId}`, onEvent);
        if (runs.get(runId) === stop) runs.delete(runId);
      };
      runs.set(runId, stop);
      bus.on(`run:${runId}`, onEvent);
      try {
        const past = await listRunEvents(runId, after);
        if (stopped) return;
        for (const e of past) deliver(e);
      } catch (err) {
        stop();
        throw err;
      }
      replaying = false;
      for (const e of buffer) deliver(e);
      send('run-ready', { runId, last });
    }

    const stream: LiveStream = {
      id,
      watch,
      unwatch: (runId) => runs.get(runId)?.(),
      close() {
        bus.off('change', onChange);
        for (const stop of [...runs.values()]) stop();
        streams.delete(id);
      },
    };
    streams.set(id, stream);
    send('hello', { id });
    return stream;
  }

  return { open, get: (id: string) => streams.get(id), size: () => streams.size };
}
