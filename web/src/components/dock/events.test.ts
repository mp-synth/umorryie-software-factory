import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunEvent } from '@factory/shared';
import { buildItems, describeSteps } from './events';

let n = 0;
const event = (type: RunEvent['type'], data: Record<string, unknown> = {}): RunEvent => ({ id: String(++n), runId: 'r', ts: '', type, data });

const events = [
  event('init', { model: 'opus' }),
  event('tool_use', { id: 'u1', name: 'Read' }),
  event('tool_result', { toolUseId: 'u1', text: 'file' }),
  event('tool_use', { id: 'u2', name: 'Read' }),
  event('tool_use', { id: 'u3', name: 'Bash' }),
  event('text', { text: 'Found it.' }),
  event('thinking', { text: 'hmm' }),
  event('tool_use', { id: 'u4', name: 'Edit' }),
  event('log', { text: 'a' }),
  event('log', { text: 'b' }),
  event('result', { costUsd: 0.1 }),
];

describe('buildItems', () => {
  it('pairs each tool call with its result and merges consecutive log lines', () => {
    const items = buildItems(events, 'normal');
    assert.deepEqual(
      items.map((i) => i.type),
      ['event', 'tool', 'tool', 'tool', 'event', 'event', 'tool', 'logs', 'event'],
    );
    const first = items[1];
    assert.ok(first.type === 'tool' && first.result?.data.text === 'file');
    const logs = items[7];
    assert.ok(logs.type === 'logs' && logs.lines.length === 2);
  });

  it('keeps only what agents say and how they ended in a summary, folding their steps', () => {
    const items = buildItems(events, 'summary');
    assert.deepEqual(
      items.map((i) => (i.type === 'steps' ? i.tools.join('+') : i.type === 'event' ? i.e.type : i.type)),
      ['Read+Read+Bash', 'text', 'Edit', 'result'],
    );
  });
});

describe('describeSteps', () => {
  it('counts the steps in words', () => {
    assert.equal(describeSteps(['Read', 'Read', 'Bash']), 'Read 2 files and ran a command');
    assert.equal(describeSteps(['Edit', 'Grep', 'TodoWrite', 'Task']), 'Edited a file, searched the code and 2 other steps');
  });
});
