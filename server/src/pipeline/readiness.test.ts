import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ticket } from '@factory/shared';
import { dependencyReady, passedGateAt, reviewWaitsFor } from './readiness.ts';

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
  for (const status of ['built', 'in_review'] as const) {
    assert.equal(dependencyReady(dep({ status, ciState: null }), onBuilt()), true, status);
  }
});

test('a dependency being fixed, checked again or sent back by its review is not built on', () => {
  for (const status of ['checking', 'changes_requested', 'fixing'] as const) {
    assert.equal(dependencyReady(dep({ status, ciState: null }), onBuilt()), false, status);
  }
});

test('a built dependency whose pushed head did not pass its checks is not built on', () => {
  assert.equal(dependencyReady({ ...dep({ status: 'built' }), gatePassedAtHead: false }, onBuilt()), false);
  assert.equal(dependencyReady({ ...dep({ status: 'built' }), gatePassedAtHead: true }, onBuilt()), true);
});

test('a foundation holds its dependents until it is approved and green', () => {
  const rules = { ...onBuilt(), foundationCheckpoint: true };
  assert.equal(dependencyReady(dep({ status: 'built', foundation: true }), rules), false);
  assert.equal(dependencyReady(dep({ status: 'approved', foundation: true, ciState: 'pending' }), rules), false);
  assert.equal(dependencyReady(dep({ status: 'approved', foundation: true, ciState: 'none' }), rules), false);
  assert.equal(dependencyReady(dep({ status: 'approved', foundation: true }), rules), true);
  assert.equal(dependencyReady(dep({ status: 'built', foundation: true }), { ...rules, foundationCheckpoint: false }), true);
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

test('a ticket is ready for the fixes above it only when its latest gate passed on the head its PR shows', () => {
  const gate = (verdict: string, headSha: string, gatePurpose?: string) => ({ kind: 'gate', verdict, headSha, gatePurpose });
  assert.equal(passedGateAt([gate('GATE: PASS', 'abc')], 'abc'), true);
  assert.equal(passedGateAt([{ kind: 'verify', verdict: 'VERIFY: APPROVE', headSha: 'abc' }, gate('GATE: PASS', 'abc')], 'abc'), true);
  assert.equal(passedGateAt([gate('GATE: PASS', 'abc')], 'def'), false, 'a push since the gate needs a new gate');
  assert.equal(passedGateAt([gate('GATE: FAIL', 'abc'), gate('GATE: PASS', 'abc')], 'abc'), false, 'the latest gate counts');
  assert.equal(passedGateAt([gate('GATE: SKIPPED', 'abc')], 'abc'), false);
  assert.equal(passedGateAt([], 'abc'), false);
  assert.equal(passedGateAt([gate('GATE: INFRA', 'abc'), gate('GATE: PASS', 'abc')], 'abc'), true, 'a gate that could not finish says nothing');
  assert.equal(passedGateAt([gate('GATE: WAITING', 'abc'), gate('GATE: PASS', 'abc')], 'abc'), false, 'a gate waiting on outside work is not green');
});

test('full checks ignore lighter sync gates while merge safety accepts them', () => {
  const sync = (verdict: string, prompt = 'pnpm merge-check') => ({ kind: 'gate', verdict, headSha: 'abc', gatePurpose: 'sync', prompt });
  const checks = (verdict: string) => ({ kind: 'gate', verdict, headSha: 'abc', gatePurpose: 'readiness' });

  assert.equal(passedGateAt([sync('GATE: PASS')], 'abc'), false);
  assert.equal(passedGateAt([sync('GATE: PASS', 'pnpm test')], 'abc', 'checks', 'pnpm test'), true, 'a sync gate may run the full checks command');
  assert.equal(passedGateAt([sync('GATE: PASS')], 'abc', 'merge'), true);
  assert.equal(passedGateAt([sync('GATE: FAIL'), checks('GATE: PASS')], 'abc'), true, 'a sync failure does not supersede full checks');
  assert.equal(passedGateAt([sync('GATE: FAIL'), checks('GATE: PASS')], 'abc', 'merge'), false, 'the latest merge gate counts');
});
