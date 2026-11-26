import assert from 'node:assert/strict';
import test from 'node:test';
import { Remembered, type RememberedStorage } from './memory.ts';

class MemoryStorage implements RememberedStorage {
  readonly rows = new Map<string, string>();
  failNextWrite = false;
  private writeStarted: (() => void) | null = null;
  private continueWrite: Promise<void> | null = null;

  constructor(rows: [string, unknown][] = []) {
    for (const [key, value] of rows) this.rows.set(key, JSON.stringify(value));
  }

  async recallPrefix(prefix: string): Promise<Map<string, string>> {
    return new Map([...this.rows].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
  }

  async remember(key: string, value: string | null): Promise<void> {
    this.writeStarted?.();
    await this.continueWrite;
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('database write failed');
    }
    if (value === null) this.rows.delete(key);
    else this.rows.set(key, value);
  }

  pauseWrite(): { started: Promise<void>; release: () => void } {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    this.continueWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.writeStarted = started;
    return {
      started: startedPromise,
      release: () => {
        this.writeStarted = null;
        this.continueWrite = null;
        release();
      },
    };
  }
}

test('set publishes to the cache only after storage succeeds', async () => {
  const storage = new MemoryStorage([['state:item', { count: 1 }]]);
  const remembered = new Remembered<{ count: number }>('state', storage);
  assert.deepEqual(await remembered.get('item'), { count: 1 });

  const paused = storage.pauseWrite();
  const writing = remembered.set('item', { count: 2 });
  await paused.started;
  assert.deepEqual(await remembered.get('item'), { count: 1 });
  paused.release();
  await writing;
  assert.deepEqual(await remembered.get('item'), { count: 2 });
});

test('failed writes leave cached values unchanged', async () => {
  const storage = new MemoryStorage([['state:item', 'old']]);
  const remembered = new Remembered<string>('state', storage);
  assert.equal(await remembered.get('item'), 'old');

  storage.failNextWrite = true;
  await assert.rejects(remembered.set('item', 'new'), /database write failed/);
  assert.equal(await remembered.get('item'), 'old');

  storage.failNextWrite = true;
  await assert.rejects(remembered.delete('item'), /database write failed/);
  assert.equal(await remembered.get('item'), 'old');
});

test('invalidate reloads values after external database cleanup', async () => {
  const storage = new MemoryStorage([['state:item', 'old']]);
  const remembered = new Remembered<string>('state', storage);
  assert.equal(await remembered.get('item'), 'old');

  storage.rows.clear();
  storage.rows.set('state:new-item', JSON.stringify('new'));
  assert.equal(await remembered.has('new-item'), false);
  remembered.invalidate();
  assert.deepEqual(await remembered.entries(), [['new-item', 'new']]);
});
