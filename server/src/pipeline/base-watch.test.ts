import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaseHeads, MergeabilityRechecks, parseLsRemote } from './base-watch.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('parses ls-remote output into branch heads', () => {
  const heads = parseLsRemote(`${A}\trefs/heads/master\n${B}\trefs/heads/factory/x/01-a\n\nnot a line\n`);
  assert.deepEqual([...heads], [['master', A], ['factory/x/01-a', B]]);
});

test('a base move is reported once, and the first sighting is not a move', () => {
  const heads = new BaseHeads();
  assert.deepEqual(heads.moved('/r', new Map([['master', A]])), []);
  assert.deepEqual(heads.moved('/r', new Map([['master', A]])), []);
  assert.deepEqual(heads.moved('/r', new Map([['master', B]])), ['master']);
  assert.deepEqual(heads.moved('/r', new Map([['master', B]])), []);
});

test('the same branch name in two repos is watched apart', () => {
  const heads = new BaseHeads();
  heads.moved('/r1', new Map([['main', A]]));
  heads.moved('/r2', new Map([['main', A]]));
  assert.deepEqual(heads.moved('/r2', new Map([['main', B]])), ['main']);
  assert.deepEqual(heads.moved('/r1', new Map([['main', A]])), []);
});

test('an undecided PR is looked at again a few times per head commit, then left to the regular sweep', () => {
  const rechecks = new MergeabilityRechecks(2);
  assert.equal(rechecks.another('t1', A), true);
  assert.equal(rechecks.another('t1', A), true);
  assert.equal(rechecks.another('t1', A), false);
  assert.equal(rechecks.another('t1', B), true, 'a new head commit starts over');
  rechecks.known('t1');
  assert.equal(rechecks.another('t1', B), true, 'a known answer clears the count');
});
