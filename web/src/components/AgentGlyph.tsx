import type { RunKind } from '@factory/shared';
import { HUE } from '@/design/tone';
import { usePreferences } from '@/lib/preferences';
import { runKind } from '@/lib/status';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'size-5 rounded-md [&_svg]:size-3',
  md: 'size-7 rounded-lg [&_svg]:size-3.5',
  lg: 'size-9 rounded-xl [&_svg]:size-[18px]',
};

/** The agent's kind as an icon tile, in its hue when the user color-codes agents and neutral otherwise. */
export function AgentGlyph({ kind, size = 'md', className }: { kind: RunKind; size?: keyof typeof SIZES; className?: string }) {
  const { agentColors } = usePreferences();
  const k = runKind[kind];
  const hue = agentColors ? HUE[k.hue] : { ink: 'text-ink-secondary', fill: 'bg-neutral-subtle' };
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center', SIZES[size], hue.fill, hue.ink, className)}>
      <k.icon />
    </span>
  );
}
