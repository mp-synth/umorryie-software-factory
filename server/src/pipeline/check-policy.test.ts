import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCheck, validCheckRules } from './check-policy.ts';

test('people-only and ignored checks come from the defaults', () => {
  assert.equal(classifyCheck({ name: 'Code review' }, []).class, 'people-only');
  assert.equal(classifyCheck({ name: 'Code review gate' }, []).class, 'people-only');
  assert.equal(classifyCheck({ name: 'mergefreeze', isRequired: true }, []).class, 'people-only');
  assert.equal(classifyCheck({ name: 'Meticulous Tests' }, []).class, 'people-only');
  assert.equal(classifyCheck({ name: 'Cursor Bugbot' }, []).class, 'ignore');
  assert.equal(classifyCheck({ name: 'coverage-comment' }, []).class, 'ignore');
  assert.equal(classifyCheck({ name: 'Deploy preview environment / preview / deploy' }, []).class, 'ignore');
});

test('lint, tests and specs are always fixed, even when branch protection does not require them', () => {
  assert.equal(classifyCheck({ name: 'lint', isRequired: true }, []).class, 'must-fix');
  assert.equal(classifyCheck({ name: 'test-unit-shard (0)' }, []).class, 'must-fix');
  assert.equal(classifyCheck({ name: 'OpenAPI Contracts / OpenAPI Contracts' }, []).class, 'must-fix');
  assert.equal(classifyCheck({ name: 'Validate API contracts' }, []).class, 'must-fix');
});

test('a check no rule names is must-fix when required and fix otherwise', () => {
  assert.equal(classifyCheck({ name: 'docker_build_ecs', isRequired: true }, []).class, 'must-fix');
  assert.equal(classifyCheck({ name: 'docker_build_ecs' }, []).class, 'fix');
});

test("the project's rules win over the defaults, in order", () => {
  const rules = [{ pattern: '^lint$', class: 'ignore' as const }];
  assert.equal(classifyCheck({ name: 'lint', isRequired: true }, rules).class, 'ignore');
});

test('a rule with a log pattern needs the log, and applies only when it matches', () => {
  const rules = [{ pattern: 'Validate API contracts', class: 'waiting-on' as const, logPattern: 'WAITING-ON-BACKEND', note: 'the backend contract' }];
  assert.deepEqual(classifyCheck({ name: 'Validate API contracts' }, rules), { class: 'waiting-on', note: 'the backend contract', needsLog: true });
  assert.equal(classifyCheck({ name: 'Validate API contracts' }, rules, 'x\nWAITING-ON-BACKEND: spec 1.2 not published\n').class, 'waiting-on');
  assert.equal(classifyCheck({ name: 'Validate API contracts' }, rules, 'types out of sync').class, 'must-fix');
  assert.equal(classifyCheck({ name: 'Validate API contracts' }, rules, null).class, 'must-fix');
});

test('invalid regular expressions are reported and never match', () => {
  assert.equal(validCheckRules([{ pattern: '(', class: 'ignore' }]).length, 1);
  assert.equal(classifyCheck({ name: '(' }, [{ pattern: '(', class: 'ignore' }]).class, 'fix');
});

test('rules match the legacy job name or its workflow-qualified alias', () => {
  const check = { name: 'Build and test', aliases: ['[Studio] Meticulous / Build and test'] };
  assert.equal(classifyCheck(check, [{ pattern: '^Build and test$', class: 'must-fix' }]).class, 'must-fix');
  assert.equal(classifyCheck(check, [{ pattern: 'Meticulous', class: 'people-only' }]).class, 'people-only');
});
