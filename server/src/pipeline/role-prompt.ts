import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RunKind } from '@factory/shared';
import { config } from '../config.ts';

export type AgentKind = Exclude<RunKind, 'gate'>;

export const ROLE_FILES: Record<AgentKind, string> = {
  plan: 'planner.md',
  plan_review: 'plan-reviewer.md',
  execute: 'executor.md',
  review: 'reviewer.md',
  fix: 'fixer.md',
  verify: 'verifier.md',
  ask: 'advisor.md',
};
export const MECHANICAL_FIXER_FILE = 'mechanical-fixer.md';

const REPO_AWARE_TOOLS = ['Skill', 'Task'];
const WEB_TOOLS = ['WebFetch', 'WebSearch'];
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Write', ...REPO_AWARE_TOOLS, ...WEB_TOOLS];
const WRITE_TOOLS = [...READ_TOOLS, 'Edit'];

export const TOOLS: Record<AgentKind, string[]> = {
  plan: READ_TOOLS,
  plan_review: READ_TOOLS,
  execute: WRITE_TOOLS,
  review: READ_TOOLS,
  fix: WRITE_TOOLS,
  verify: READ_TOOLS,
  ask: READ_TOOLS,
};

const DENIED_FOR_EVERY_AGENT = [
  'Bash(git push:*)',
  'Bash(git stash:*)',
  'Bash(gh pr create:*)',
  'Bash(gh pr merge:*)',
  'Bash(gh pr close:*)',
  'Bash(gh pr comment:*)',
  'Bash(gh pr edit:*)',
  'Bash(gh pr review:*)',
  'Bash(gh pr ready:*)',
  'Bash(gh pr reopen:*)',
  'Bash(gh issue create:*)',
  'Bash(gh issue comment:*)',
  'Bash(gh issue close:*)',
  'Bash(gh release:*)',
];
const DENIED_FOR_READ_ONLY_AGENTS = ['Bash(git commit:*)', 'Bash(git reset:*)', 'Bash(git rebase:*)'];
const READ_ONLY_DENIALS = [...DENIED_FOR_EVERY_AGENT, ...DENIED_FOR_READ_ONLY_AGENTS];

export const DISALLOWED_TOOLS: Record<AgentKind, string[]> = {
  plan: READ_ONLY_DENIALS,
  plan_review: READ_ONLY_DENIALS,
  execute: DENIED_FOR_EVERY_AGENT,
  review: READ_ONLY_DENIALS,
  fix: DENIED_FOR_EVERY_AGENT,
  verify: READ_ONLY_DENIALS,
  ask: READ_ONLY_DENIALS,
};

export const EFFORT: Record<AgentKind, string> = {
  plan: 'high',
  plan_review: 'high',
  execute: 'high',
  review: 'high',
  fix: 'high',
  verify: 'high',
  ask: 'medium',
};

const STEPS_THAT_WRITE_OR_JUDGE_CODE: RunKind[] = ['execute', 'fix', 'review', 'verify'];

export function readAgentFile(file: string): string {
  return fs.readFileSync(path.isAbsolute(file) ? file : path.join(config.agentsDir, file), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

export function rolePrompt(kind: AgentKind, roleFile = ROLE_FILES[kind]): string {
  const parts = [readAgentFile(roleFile), readAgentFile('repo-rules.md')];
  if (STEPS_THAT_WRITE_OR_JUDGE_CODE.includes(kind)) parts.push(readAgentFile('code-style.md'));
  return parts.join('\n\n');
}

export function header(title: string, fields: [string, string | null | undefined][], inputs: string[], outputs: string[], reply: string): string {
  const lines = [title];
  for (const [k, v] of fields) if (v) lines.push(`${k}: ${v}`);
  lines.push('Inputs:');
  for (const i of inputs) lines.push(`- ${i}`);
  lines.push(outputs.length > 1 ? 'Outputs:' : `Output: ${outputs[0]}`);
  if (outputs.length > 1) for (const o of outputs) lines.push(`- ${o}`);
  lines.push(reply);
  return lines.join('\n');
}

export function rolePromptSha(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex');
}
