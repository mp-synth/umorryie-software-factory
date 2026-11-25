import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ticket } from '@factory/shared';
import { dependencyReady, reviewWaitsFor } from './readiness.ts';

const dep = (patch: Partial<Ticket> = {}) => ({ status: 'approved' as Ticket['status'], prNumber: 4, prState: 'OPEN', ciState: 'green' as Ticket['ciState'], ...patch });
const onApproved = (waitForCi: boolean) => ({ waitForCi, startWhenBuilt: false });
const onBuilt = (waitForCi = false) => ({ waitForCi, startWhenBuilt: true });

test('an approved dependency with green CI is ready either way', () => {
  assert.equal(dependencyReady(dep(), onApproved(true)), true);
  assert.equal(dependencyReady(dep(), onApproved(false)), true);
  assert.equal(dependencyReady(dep(), onBuilt(true)), true);
});

test('pending or red CI holds dependents back only when the setting is on', () => {
  for (const ciState of ['pending', 'red', null] as const) {
    assert.equal(dependencyReady(dep({ ciState }), onApproved(true)), false);
    assert.equal(dependencyReady(dep({ ciState }), onApproved(false)), true);
    assert.equal(dependencyReady(dep({ status: 'in_review', ciState }), onBuilt(true)), false);
  }
});

test('a PR without CI checks does not hold dependents back', () => {
  assert.equal(dependencyReady(dep({ ciState: 'none' }), onApproved(true)), true);
});

test('merged dependencies and dependencies without a PR are unaffected', () => {
  assert.equal(dependencyReady(dep({ status: 'merged', ciState: 'red' }), onApproved(true)), true);
  assert.equal(dependencyReady(dep({ prNumber: null, prState: null, ciState: null }), onApproved(true)), true);
});

test('a dependency that is not approved is not ready while dependents wait for approval', () => {
  assert.equal(dependencyReady(dep({ status: 'built' }), onApproved(false)), false);
});

test('a built dependency with an open PR is ready when dependents start once it is built', () => {
  for (const status of ['checking', 'built', 'in_review', 'changes_requested', 'fixing'] as const) {
    assert.equal(dependencyReady(dep({ status, ciState: null }), onBuilt()), true, status);
  }
});

test('a dependency still building, blocked, or without an open PR is not ready to build on', () => {
  for (const status of ['todo', 'building', 'blocked', 'canceled'] as const) assert.equal(dependencyReady(dep({ status }), onBuilt()), false, status);
  // Without a PR, nothing carries its later fixes up to the ticket on top.
  assert.equal(dependencyReady(dep({ status: 'built', prNumber: null, prState: null }), onBuilt()), false);
  assert.equal(dependencyReady(dep({ status: 'built', prState: 'CLOSED' }), onBuilt()), false);
});

const t = (status: Ticket['status'], lastVerdict: string | null = null) => ({ status, lastVerdict });

test('a first review waits until the ticket below is approved', () => {
  const below = t('in_review');
  assert.equal(reviewWaitsFor(t('built'), below, true), below);
  assert.equal(reviewWaitsFor(t('built'), t('approved'), true), null);
});

test('a review does not wait with no ticket below, after a first review, or when dependents wait for approval', () => {
  assert.equal(reviewWaitsFor(t('built'), null, true), null);
  assert.equal(reviewWaitsFor(t('built', 'CHANGES'), t('in_review'), true), null);
  assert.equal(reviewWaitsFor(t('built'), t('in_review'), false), null);
});
