import { Bot, CircleDollarSign, FolderGit2, Inbox, LayoutGrid, Settings2, type LucideIcon } from 'lucide-react';

export interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const NAV: NavEntry[] = [
  { to: '/inbox', label: 'Inbox', icon: Inbox, description: 'Everything waiting on you' },
  { to: '/', label: 'Overview', icon: LayoutGrid, description: 'All initiatives and what the factory is doing' },
  { to: '/agents', label: 'Agents', icon: Bot, description: 'Every agent run, live and past' },
  { to: '/projects', label: 'Projects', icon: FolderGit2, description: 'Repositories the factory builds in' },
  { to: '/usage', label: 'Usage', icon: CircleDollarSign, description: 'What the agents spent' },
  { to: '/settings', label: 'Settings', icon: Settings2, description: 'Appearance, notifications and agent limits' },
];

export const NAV_ICONS: Record<string, LucideIcon> = Object.fromEntries(NAV.map((n) => [n.to, n.icon]));
