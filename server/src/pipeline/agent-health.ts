const SIGNED_OUT = /^(?:agent ended with an error[^:]*:\s*|api error:\s*)?(?:not logged in|please run \/login|invalid api key|oauth token (?:has )?expired|authentication_error)\b/i;
const OUT_OF_ALLOWANCE = /^(?:claude(?: ai)?\s+|api error:\s*)?(?:usage limit reached|limit will reset|credit balance is too low|exceeded your (?:current )?quota)\b/i;

export type AgentUnavailable = { kind: 'signed-out' | 'allowance'; message: string };

/**
 * Why no agent can work right now, from what a failed agent printed: the Claude login expired or the plan's
 * allowance ran out. Every agent fails the same way until that changes, so the factory pauses instead of
 * failing runs one by one and asking the arbiter about each.
 */
export function agentUnavailable(text: string | null | undefined): AgentUnavailable | null {
  if (!text) return null;
  const line = text.split('\n').find((l) => SIGNED_OUT.test(l) || OUT_OF_ALLOWANCE.test(l))?.trim();
  if (!line) return null;
  return { kind: SIGNED_OUT.test(line) ? 'signed-out' : 'allowance', message: line.slice(0, 300) };
}

export function pauseReason(u: AgentUnavailable): string {
  return u.kind === 'signed-out'
    ? `Claude is signed out (${u.message}). Run \`claude\` and log in; the factory resumes on its own once an agent can start.`
    : `Claude's usage allowance ran out (${u.message}). The factory resumes on its own once an agent can start.`;
}
