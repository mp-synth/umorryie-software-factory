#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const emit = (msg) => console.log(JSON.stringify(msg));

const init = () => emit({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'fake-model', cwd: process.cwd(), tools: ['Read', 'Bash'] });

const conversation = () => {
  emit({
    type: 'assistant',
    message: {
      content: [
        { type: 'thinking', thinking: 'planning the work' },
        { type: 'text', text: 'Reading the file' },
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/a.txt' } },
      ],
    },
  });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: false, content: [{ type: 'text', text: 'file body' }] }] } });
};

const result = (extra = {}) =>
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 12,
    num_turns: 3,
    result: 'all done',
    total_cost_usd: 0.25,
    usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 },
    ...extra,
  });

switch (process.env.FAKE_SCENARIO) {
  case 'success':
    init();
    conversation();
    result();
    break;
  case 'noise':
    console.log('Warning: not json');
    init();
    console.log('{"type": broken');
    conversation();
    result();
    break;
  case 'error-result':
    init();
    result({ subtype: 'error_max_turns', is_error: true, result: 'ran out of turns' });
    break;
  case 'environment':
    init();
    result({ result: JSON.stringify({ tmpdir: process.env.TMPDIR ?? null, autoMemoryOff: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? null }) });
    break;
  case 'crash':
    init();
    console.error('boom: something broke');
    process.exit(3);
    break;
  case 'hang':
    init();
    setInterval(() => {}, 1000);
    break;
  case 'slow': {
    init();
    const steps = Number(process.env.FAKE_STEPS ?? 5);
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      emit({ type: 'assistant', message: { content: [{ type: 'text', text: `step ${step}` }] } });
      if (step < steps) return;
      clearInterval(timer);
      result();
    }, Number(process.env.FAKE_STEP_MS ?? 100));
    break;
  }
  case 'linger':
    init();
    result();
    setInterval(() => {}, 1000);
    break;
  case 'background-child': {
    const background = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    background.unref();
    fs.writeFileSync(process.env.FAKE_CHILD_PID_FILE, String(background.pid));
    init();
    result();
    break;
  }
  default:
    process.exit(2);
}
