import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { agentEnvironment, isEnvFile, looksSecret, redactDeep, redactor } from './agent-env.ts';

function repoWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-env-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

const FAKE_KEY = 'fake-key-0123456789abcdef';

test('env vars from copied env files reach agents, except ones that would change how Claude or git authenticate', () => {
  const dir = repoWith({
    '.env': `LAGO_API_URL=https://lago.dev.example.com\nLAGO_API_KEY=${FAKE_KEY}\nANTHROPIC_API_KEY=sk-ant-service-key-0000\nexport MONGO_URL="mongodb://localhost:27017"\n`,
    'config.json': '{"NOT_AN_ENV_FILE": true}',
  });
  const env = agentEnvironment(dir, ['.env', 'config.json', '.env.missing'], {});
  assert.deepEqual(env.vars, { LAGO_API_URL: 'https://lago.dev.example.com', LAGO_API_KEY: FAKE_KEY, MONGO_URL: 'mongodb://localhost:27017' });
  assert.deepEqual(env.secretNames.sort(), ['ANTHROPIC_API_KEY', 'LAGO_API_KEY']);
});

test('cloud credentials stay out of agents only when Claude itself authenticates through that cloud', () => {
  const dir = repoWith({ '.env': 'AWS_ACCESS_KEY_ID=AKIAEXAMPLE\nAWS_REGION=eu-west-1\n' });
  assert.deepEqual(Object.keys(agentEnvironment(dir, ['.env'], {}).vars), ['AWS_ACCESS_KEY_ID', 'AWS_REGION']);
  assert.deepEqual(agentEnvironment(dir, ['.env'], { CLAUDE_CODE_USE_BEDROCK: '1' }).vars, {});
});

test('secret values are replaced by their name everywhere in an agent event', () => {
  const dir = repoWith({ '.env': `LAGO_API_KEY=${FAKE_KEY}\nDATABASE_URL=postgres://app:hunter2hunter2@db:5432/app\n` });
  const { redact } = agentEnvironment(dir, ['.env'], {});
  const event = { input: { command: `curl -H "Authorization: Bearer ${FAKE_KEY}"` }, lines: ['postgres://app:hunter2hunter2@db:5432/app'], n: 3 };
  assert.deepEqual(redactDeep(event, redact), {
    input: { command: 'curl -H "Authorization: Bearer [redacted LAGO_API_KEY]"' },
    lines: ['[redacted DATABASE_URL]'],
    n: 3,
  });
});

test('a longer secret is redacted before a shorter one it contains', () => {
  const redact = redactor([['SHORT', 'abcdefgh'], ['LONG', 'abcdefgh-ijklmnop']]);
  assert.equal(redact('abcdefgh-ijklmnop and abcdefgh'), '[redacted LONG] and [redacted SHORT]');
});

test('plain settings are not treated as secrets', () => {
  assert.equal(looksSecret('LAGO_API_URL', 'https://lago.dev.example.com/api/v1/some/long/path'), false);
  assert.equal(looksSecret('LOG_LEVEL', 'debug'), false);
  assert.equal(looksSecret('SERVICE_ID', 'f3a9c1d2e4b5a6c7d8e9f0a1b2c3d4e5'), true);
  assert.equal(looksSecret('API_TOKEN', 'short'), false);
});

test('env files are recognised by name', () => {
  assert.ok(isEnvFile('.env'));
  assert.ok(isEnvFile('.env.local'));
  assert.ok(isEnvFile('apps/api/test.env'));
  assert.ok(!isEnvFile('.envrc'));
  assert.ok(!isEnvFile('settings.json'));
});
