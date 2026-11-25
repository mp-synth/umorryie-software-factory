import { Keyboard } from 'lucide-react';
import { Dialog, Kbd } from '@/components/ui';
import { SHORTCUTS, type Shortcut } from '@/lib/shortcuts';

const GROUPS: Shortcut['group'][] = ['General', 'Go to', 'Layout', 'Writing'];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" icon={<Keyboard />} title="Keyboard shortcuts" description="Single keys work anywhere except while you type in a field.">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g}>
            <h3 className="eyebrow mb-2">{g}</h3>
            <ul className="space-y-1.5">
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
                  <span>{s.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k, i) => (
                      <span key={k} className="flex items-center gap-1">
                        {i > 0 && s.group === 'Go to' && <span className="text-2xs text-ink-tertiary">then</span>}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
