export function seqLabel(seq: number): string {
  return String(seq).padStart(2, '0');
}

export function ticketLabel(t: { seq: number; title: string }): string {
  return `[${seqLabel(t.seq)}] ${t.title}`;
}
