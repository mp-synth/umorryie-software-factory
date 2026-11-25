import { BellRing } from 'lucide-react';
import { useState } from 'react';
import { Button, Callout, Card, CardHeader, SwitchRow } from '@/components/ui';
import { notificationsSupported } from '@/lib/attention';
import { setPreferences, usePreferences } from '@/lib/preferences';

export function NotificationSettings() {
  const { notifications } = usePreferences();
  const supported = notificationsSupported();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(supported ? Notification.permission : 'unsupported');

  const turn = async (on: boolean) => {
    if (!on || !supported) return setPreferences({ notifications: on && supported });
    const result = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setPermission(result);
    setPreferences({ notifications: result === 'granted' });
  };
  const test = () => new Notification('Software Factory', { body: 'Notifications work. You will hear from the factory when something needs you.' });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader icon={<BellRing />} title="When something needs you" />
        <SwitchRow
          label="Send me a notification"
          description="A system notification the moment a plan is ready for your review, a planner has questions or a ticket stops. Click it to jump straight there."
          checked={notifications && permission === 'granted'}
          disabled={permission === 'unsupported'}
          onChange={turn}
        />
        <div className="space-y-3 border-t border-line-subtle px-4 py-3">
          {permission === 'denied' && (
            <Callout tone="bad" title="Your browser blocks notifications for this site">
              Allow them in the site settings, behind the icon left of the address bar, then reload this page.
            </Callout>
          )}
          {permission === 'unsupported' && <Callout tone="warn" title="This browser cannot show notifications" />}
          {permission === 'granted' && notifications && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-sm text-ink-secondary">Notifications are on.</p>
              <Button size="sm" variant="outline" onClick={test}>
                Send a test notification
              </Button>
            </div>
          )}
          <p className="text-pretty text-xs text-ink-tertiary">
            With or without notifications, the browser tab tells you too: its title starts with a count and its icon gets a dot whenever something waits on you.
          </p>
        </div>
      </Card>
    </div>
  );
}
