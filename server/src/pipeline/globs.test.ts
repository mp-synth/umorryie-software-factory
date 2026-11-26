import assert from 'node:assert/strict';
import test from 'node:test';
import { globPattern } from './globs.ts';

test('path globs match files the way the owner writes them', () => {
  assert.ok(globPattern('idl/**').test('idl/billing/openapi.json'));
  assert.ok(globPattern('idl/').test('idl/billing/openapi.json'));
  assert.ok(globPattern('**/openapi.json').test('idl/billing/openapi.json'));
  assert.ok(globPattern('**/openapi.json').test('openapi.json'));
  assert.ok(globPattern('src/*.gen.ts').test('src/routes.gen.ts'));
  assert.ok(!globPattern('src/*.gen.ts').test('src/a/routes.gen.ts'));
  assert.ok(!globPattern('idl/**').test('service/idl.py'));
  assert.ok(globPattern('uv.lock').test('uv.lock'));
  assert.ok(!globPattern('uv.lock').test('uvXlock'));
});
