import { EventEmitter } from 'node:events';
import type { ChangeEvent, RunEvent } from '@factory/shared';

export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitChange(e: ChangeEvent): void {
  bus.emit('change', e);
}

export function emitRunEvent(runId: string, e: RunEvent): void {
  bus.emit(`run:${runId}`, e);
}
