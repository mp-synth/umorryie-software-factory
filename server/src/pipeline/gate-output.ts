const TAIL_LINES = 200;
const MAX_FAILING_LINES = 60;
const FAILURE_MARKER = /error|Error:|FAIL|failed|\u274c|TS\d{4}|E\d{3,4}|not ok/;

export type GateResult = {
  command: string;
  code: number;
  timedOut: boolean;
  seconds: number;
  cwd: string;
  output: string;
  logPath: string;
};

export function failingLines(lines: string[]): string[] {
  const picked = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!FAILURE_MARKER.test(lines[i])) continue;
    for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < lines.length) picked.add(j);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of [...picked].sort((a, b) => a - b)) {
    if (seen.has(lines[i])) continue;
    seen.add(lines[i]);
    out.push(lines[i]);
  }
  return out.slice(0, MAX_FAILING_LINES);
}

export function gateBody(r: GateResult): string {
  const lines = r.output.split('\n');
  const failing = r.code !== 0 && lines.length > TAIL_LINES ? failingLines(lines) : [];
  return [
    '## Command',
    '```',
    r.command,
    '```',
    '',
    '## Result',
    `exit ${r.code}${r.timedOut ? ' (timed out)' : ''} in ${r.seconds}s, run in ${r.cwd}`,
    '',
    ...(failing.length ? ['## Failing lines', '```', ...failing, '```', ''] : []),
    `## Output (last ${TAIL_LINES} lines)`,
    '```',
    lines.slice(-TAIL_LINES).join('\n'),
    '```',
    '',
    `Full output: ${r.logPath}. Search that file for the failure instead of re-running the whole command to see more.`,
  ].join('\n');
}
