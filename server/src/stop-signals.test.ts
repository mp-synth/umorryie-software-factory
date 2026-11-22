import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stopSignals } from './stop-signals.ts';

function clock(...times: number[]): () => number {
  const queue = [...times];
  return () => queue.shift()!;
}

test('the first signal starts the stop', () => {
  assert.equal(stopSignals(clock(0))(), 'stop');
});

test('signals relayed within a second of the first belong to the same Ctrl-C', () => {
  const next = stopSignals(clock(0, 33, 1000));
  assert.equal(next(), 'stop');
  assert.equal(next(), 'copy-of-the-stop');
  assert.equal(next(), 'copy-of-the-stop');
});

test('a Ctrl-C pressed again later stops the server at once', () => {
  const next = stopSignals(clock(0, 32, 2500));
  assert.equal(next(), 'stop');
  assert.equal(next(), 'copy-of-the-stop');
  assert.equal(next(), 'stop-now');
});
