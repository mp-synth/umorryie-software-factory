import { AlertOctagon, ClipboardCheck, MessageCircleQuestion } from 'lucide-react';
import { TONE } from '@/design/tone';
import type { InboxItem, InboxKind } from '@/lib/initiative';
import { cn } from '@/lib/utils';

const KIND_ICONS: Record<InboxKind, typeof AlertOctagon> = {
  approve: ClipboardCheck,
  questions: MessageCircleQuestion,
  failed: AlertOctagon,
  blocked: AlertOctagon,
};

export function InboxItemIcon({ item, size = 'md' }: { item: InboxItem; size?: 'sm' | 'md' }) {
  const Icon = KIND_ICONS[item.kind];
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center',
        size === 'md' ? 'size-9 rounded-lg [&_svg]:size-[18px]' : 'size-7 rounded-md [&_svg]:size-4',
        TONE[item.tone].fill,
        TONE[item.tone].ink,
      )}
    >
      <Icon />
    </span>
  );
}
