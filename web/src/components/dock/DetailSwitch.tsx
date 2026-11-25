import { Segmented } from '@/components/ui';
import { setPreferences, usePreferences } from '@/lib/preferences';

export function DetailSwitch() {
  const { activityDetail } = usePreferences();
  return (
    <Segmented
      size="xs"
      label="How much activity to show"
      value={activityDetail}
      onChange={(v) => setPreferences({ activityDetail: v })}
      options={[
        { value: 'summary', label: 'Summary', title: 'What the agents say and how each run ended' },
        { value: 'normal', label: 'Normal', title: 'Tool calls folded to one line each' },
        { value: 'verbose', label: 'Verbose', title: 'Every tool call and thought, open' },
      ]}
    />
  );
}
