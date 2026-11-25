import { BellRing, BookOpen, Bot, Cpu, Palette } from 'lucide-react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { usePageMeta } from '@/components/shell/page-meta';
import { Page, PageHeader, Tabs } from '@/components/ui';
import { AgentSettings } from './settings/AgentSettings';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { EnvironmentSettings } from './settings/EnvironmentSettings';
import { HowItWorks } from './settings/HowItWorks';
import { NotificationSettings } from './settings/NotificationSettings';

const SECTIONS = {
  appearance: { label: 'Appearance', icon: <Palette />, page: AppearanceSettings },
  notifications: { label: 'Notifications', icon: <BellRing />, page: NotificationSettings },
  agents: { label: 'Agents and limits', icon: <Bot />, page: AgentSettings },
  environment: { label: 'Environment', icon: <Cpu />, page: EnvironmentSettings },
  'how-it-works': { label: 'How it works', icon: <BookOpen />, page: HowItWorks },
} as const;
type Section = keyof typeof SECTIONS;

export function SettingsPage() {
  const { section = 'appearance' } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const known = section in SECTIONS;
  const current = SECTIONS[(known ? section : 'appearance') as Section];
  usePageMeta(current.label, [{ label: 'Settings', to: '/settings' }]);
  if (!known) return <Navigate to="/settings" replace />;
  const Content = current.page;
  return (
    <Page>
      <PageHeader title="Settings" />
      <Tabs
        label="Settings sections"
        value={section as Section}
        onChange={(s) => navigate(`/settings/${s}`)}
        items={(Object.keys(SECTIONS) as Section[]).map((s) => ({ value: s, label: SECTIONS[s].label, icon: SECTIONS[s].icon }))}
      />
      <div className="mt-6">
        <Content />
      </div>
    </Page>
  );
}
