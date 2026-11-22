import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { setThemePreference, useTheme, type ThemePreference } from '@/lib/theme';
import { Button, Menu, MenuItem } from './ui';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function ThemeMenu() {
  const { preference } = useTheme();
  const current = OPTIONS.find((o) => o.value === preference) ?? OPTIONS[0];
  return (
    <Menu
      align="start"
      trigger={
        <Button variant="ghost" size="xs" className="w-6 px-0" aria-label={`Theme: ${current.label}`} title={`Theme: ${current.label}`}>
          <current.icon className="h-3.5 w-3.5" />
        </Button>
      }
    >
      {OPTIONS.map((o) => (
        <MenuItem key={o.value} icon={<o.icon />} onSelect={() => setThemePreference(o.value)} hint={o.value === preference ? <Check className="h-3.5 w-3.5" /> : undefined}>
          {o.label}
        </MenuItem>
      ))}
    </Menu>
  );
}
