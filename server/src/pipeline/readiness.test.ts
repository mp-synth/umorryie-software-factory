import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ticket } from '@factory/shared';
import { dependencyReady } from './readiness.ts';

const dep = (patch: Partial<Ticket> = {}) => ({ status: 'approved' as const, prNumber: 4, prState: 'OPEN', ciState: 'green' as Ticket['ciState'], ...patch });

test('an approved dependency with green CI is ready either way', () => {
  assert.equal(dependencyReady(dep(), true), true);
  assert.equal(dependencyReady(dep(), false), true);
});

test('pending or red CI holds dependents back only when the setting is on', () => {
  for (const ciState of ['pending', 'red', null] as const) {
    assert.equal(dependencyReady(dep({ ciState }), true), false);
    assert.equal(dependencyReady(dep({ ciState }), false), true);
  }
});

test('a PR without CI checks does not hold dependents back', () => {
  assert.equal(dependencyReady(dep({ ciState: 'none' }), true), true);
});

test('merged dependencies and dependencies without a PR are unaffected', () => {
  assert.equal(dependencyReady(dep({ status: 'merged', ciState: 'red' }), true), true);
  assert.equal(dependencyReady(dep({ prNumber: null, prState: null, ciState: null }), true), true);
});

test('a dependency that is not approved is never ready', () => {
  assert.equal(dependencyReady(dep({ status: 'built' }), false), false);
});
