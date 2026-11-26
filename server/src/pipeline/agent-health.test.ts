import assert from 'node:assert/strict';
import test from 'node:test';
import { agentUnavailable } from './agent-health.ts';

test('an expired login is told apart from an exhausted allowance', () => {
  assert.equal(agentUnavailable('agent ended with an error (success): Not logged in · Please run /login')?.kind, 'signed-out');
  assert.equal(agentUnavailable('Claude AI usage limit reached|1764100000')?.kind, 'allowance');
});

test('ordinary failures are not an outage', () => {
  assert.equal(agentUnavailable('agent did not write fix.md'), null);
  assert.equal(agentUnavailable(null), null);
  assert.equal(agentUnavailable('the login page returns 500 in test_login.py'), null);
  assert.equal(agentUnavailable('API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}'), null, 'a passing 429 is retried, not a pause');
  assert.equal(agentUnavailable('The test fixture says "exceeded your quota" when billing is disabled.'), null, 'quoted product output is not a global outage');
});
