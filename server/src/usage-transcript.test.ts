import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  factoryKindOf,
  findTranscript,
  initiativeIdPrefix,
  labelFromPrompt,
  peekSession,
  priceModelId,
  priceResponse,
  projectDirName,
  readSessionUsage,
} from './usage-transcript.ts';

const SID = '49b84a63-71d6-4c4a-9bbb-2654861d87b0';

function line(o: Record<string, unknown>): string {
  return `${JSON.stringify(o)}\n`;
}

function response(id: string, ts: string, usage: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return line({ type: 'assistant', timestamp: ts, sessionId: SID, entrypoint: 'sdk-cli', cwd: '/work/repo', requestId: `req_${id}`, message: { id, model: 'claude-opus-5-5', usage }, ...extra });
}

function transcript(body: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-test-'));
  const dir = path.join(root, projectDirName('/work/repo'));
  fs.mkdirSync(dir);
  const file = path.join(dir, `${SID}.jsonl`);
  fs.writeFileSync(file, body);
  return file;
}

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('a response is priced per token class: 5-minute and 1-hour cache writes, cache reads, output', () => {
  const cost = priceResponse('claude-opus-5-5', {
    input_tokens: 1_000_000,
    cache_creation_input_tokens: 3_000_000,
    cache_creation: { ephemeral_5m_input_tokens: 2_000_000, ephemeral_1h_input_tokens: 1_000_000 },
    cache_read_input_tokens: 10_000_000,
    output_tokens: 1_000_000,
  });
  near(cost!, 4 + 2 * 4 * 1.25 + 4 * 2 + 10 * 0.2 + 20);
});

test('fast mode doubles the price, earlier models keep theirs, and an unknown model has none', () => {
  near(priceResponse('claude-opus-5-5', { output_tokens: 1_000_000, speed: 'fast' })!, 40);
  near(priceResponse('claude-fable-5-1', { output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 })!, 50.25);
  assert.equal(priceResponse('claude-opus-3', { output_tokens: 1 }), null);
});

test('long Haiku prompts are billed at the higher tier', () => {
  near(priceResponse('claude-haiku-5-5', { input_tokens: 50_000 })!, 0.005);
  near(priceResponse('claude-haiku-5-5', { input_tokens: 200_000 })!, 0.1);
  near(priceResponse('claude-haiku-5-5-20261103', { input_tokens: 200_000 })!, 0.1);
});

test('snapshot dates and context variants are priced as the model they belong to', () => {
  assert.equal(priceModelId('claude-opus-5-5-20261103'), 'claude-opus-5-5');
  assert.equal(priceModelId('claude-sonnet-5-5[1m]'), 'claude-sonnet-5-5');
  assert.equal(priceModelId('claude-opus-4-8-20260101[1m]'), 'claude-opus-4-8');
  assert.equal(priceModelId('claude-opus-5'), 'claude-opus-5');
  near(priceResponse('claude-opus-5-5-20261103', { output_tokens: 1_000_000 })!, 20);
  near(priceResponse('claude-sonnet-5-5[1m]', { output_tokens: 1_000_000 })!, 10);
});

test('a session is attributed to the model id without its snapshot date', async () => {
  const file = transcript(response('msg_1', '2026-11-23T10:00:00Z', { output_tokens: 1_000_000 }, { message: { id: 'msg_1', model: 'claude-opus-5-5-20261103', usage: { output_tokens: 1_000_000 } } }));
  const u = (await readSessionUsage(file))!;
  assert.equal(u.model, 'claude-opus-5-5');
  assert.equal(u.unpriced, 0);
  near(u.costUsd, 20);
});

test('responses from a model without a price count as unpriced', async () => {
  const file = transcript(
    response('msg_1', '2026-11-23T10:00:00Z', { output_tokens: 1_000_000 }) +
      response('msg_2', '2026-11-23T10:01:00Z', { output_tokens: 1_000_000 }, { message: { id: 'msg_2', model: 'claude-future-9', usage: { output_tokens: 1_000_000 } } }),
  );
  const u = (await readSessionUsage(file))!;
  assert.equal(u.requests, 2);
  assert.equal(u.unpriced, 1);
  near(u.costUsd, 20);
});

test('a session sums each response once, even when it was written over several lines', async () => {
  const file = transcript(
    line({ type: 'user', message: { content: 'Factory step: execute. Ticket: [01] Serve it\nmore' } }) +
      response('msg_1', '2026-11-23T10:00:00Z', { input_tokens: 2, cache_creation_input_tokens: 20_000, output_tokens: 10 }) +
      response('msg_1', '2026-11-23T10:00:01Z', { input_tokens: 2, cache_creation_input_tokens: 20_000, output_tokens: 300 }) +
      response('msg_2', '2026-11-23T10:05:00Z', { input_tokens: 1, cache_read_input_tokens: 20_000, output_tokens: 100 }) +
      'not json\n',
  );
  const u = (await readSessionUsage(file))!;
  assert.equal(u.sessionId, SID);
  assert.equal(u.requests, 2);
  assert.deepEqual(u.tokens, { input: 3, cacheWrite: 20_000, cacheRead: 20_000, output: 400 });
  assert.equal(u.startedAt, '2026-11-23T10:00:00Z');
  assert.equal(u.finishedAt, '2026-11-23T10:05:00Z');
  assert.equal(u.model, 'claude-opus-5-5');
  near(u.costUsd, (3 * 4 + 20_000 * 5 + 20_000 * 0.2 + 400 * 20) / 1e6);
  assert.equal(u.entrypoint, 'sdk-cli');
  assert.match(u.firstPrompt, /^Factory step: execute/);
});

test('subagent transcripts kept beside the session count toward it', async () => {
  const file = transcript(response('msg_1', '2026-11-23T10:00:00Z', { output_tokens: 1_000_000 }));
  const sub = path.join(file.slice(0, -'.jsonl'.length), 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-1.jsonl'), response('msg_9', '2026-11-23T10:01:00Z', { output_tokens: 1_000_000 }, { isSidechain: true }));
  const u = (await readSessionUsage(file))!;
  assert.equal(u.requests, 2);
  near(u.costUsd, 40);
});

test('a transcript with no responses has no usage', async () => {
  assert.equal(await readSessionUsage(transcript(line({ type: 'user', message: { content: 'hi' } }))), null);
});

test('a transcript is found by its working directory, or by searching every project folder', () => {
  const file = transcript('');
  const root = path.dirname(path.dirname(file));
  assert.equal(findTranscript(SID, '/work/repo', root), file);
  assert.equal(findTranscript(SID, '/somewhere/else', root), file);
  assert.equal(findTranscript('00000000-0000-4000-8000-000000000000', null, root), null);
});

test('peeking reads how a session started without reading all of it', async () => {
  const file = transcript(line({ type: 'user', entrypoint: 'claude-desktop', message: { content: [{ type: 'text', text: 'run server' }] } }) + 'x\n'.repeat(1000));
  assert.deepEqual(await peekSession(file), { entrypoint: 'claude-desktop', firstPrompt: 'run server' });
});

test('only sessions the factory started count as factory sessions', () => {
  assert.equal(factoryKindOf({ entrypoint: 'sdk-cli', firstPrompt: 'Factory step: plan-review. Initiative: X' }), 'plan_review');
  assert.equal(factoryKindOf({ entrypoint: 'sdk-cli', firstPrompt: 'Repository: /r\nDecide how the factory prepares and checks' }), 'discovery');
  assert.equal(factoryKindOf({ entrypoint: 'claude-desktop', firstPrompt: 'Factory step: fix.' }), null);
  assert.equal(factoryKindOf({ entrypoint: 'sdk-cli', firstPrompt: 'summarize this' }), null);
  assert.equal(factoryKindOf({ entrypoint: 'sdk-cli', firstPrompt: 'Factory step: review. Ticket: [01] x', cwd: '/var/folders/T/factory-eval-abc/repo' }), 'eval');
});

test('labels come from the first line of the prompt', () => {
  assert.equal(labelFromPrompt('Factory step: fix. Ticket: [02] Billing: Request usage\nMain checkout'), '[02] Billing: Request usage');
  assert.equal(labelFromPrompt('Factory step: arbitrate. Initiative: Open PRs · TTVPlatform · Ticket: [02] PR 34544'), 'Open PRs · TTVPlatform · [02] PR 34544');
  assert.equal(labelFromPrompt('Repository: /Users/me/workspace/EnactServices\nDecide'), 'EnactServices');
});

test('worktrees and initiative folders name their initiative', () => {
  assert.equal(initiativeIdPrefix('/Users/me/.software-factory/worktrees/enactservices/return-each-row-63566919/05-video'), '63566919');
  assert.equal(initiativeIdPrefix('/Users/me/.software-factory/initiatives/usage-breakdown-2a7fea3b'), '2a7fea3b');
  assert.equal(initiativeIdPrefix('/Users/me/workspace/EnactServices'), null);
});
