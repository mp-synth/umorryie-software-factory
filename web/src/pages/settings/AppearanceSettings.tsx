import { Check, RotateCcw } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Button, Card, CardHeader, OptionCards, Segmented, SwitchRow } from '@/components/ui';
import { hasBasierSquare } from '@/design/fonts';
import {
  ACCENTS,
  DARK_CANVASES,
  DENSITIES,
  NEUTRALS,
  RADII,
  SYNTHESIA_RAMPS,
  SYSTEM_RAMPS,
  TEXT_SIZES,
  TYPEFACES,
  type AccentName,
  type NeutralName,
  type Step,
} from '@/design/tokens';
import { DEFAULT_PREFERENCES, preferences, setPreferences, usePreferences, useResolvedMode, type Mode, type ModePreference } from '@/lib/preferences';
import { cn, keysOf } from '@/lib/utils';


const accentColor = (name: AccentName, step: Step) => {
  const ramp = ACCENTS[name].ramp;
  return ramp ? SYSTEM_RAMPS[ramp][step] : SYNTHESIA_RAMPS.accent[step];
};

const neutralColor = (name: NeutralName, step: Step) => {
  const ramp = NEUTRALS[name].ramp;
  return ramp ? SYSTEM_RAMPS[ramp][step] : SYNTHESIA_RAMPS.neutral[step];
};

/**
 * A tiny window in one mode. A light preview on a dark page (and the reverse) is an inverted surface:
 * Framework 26 surface polarity renders the other mode's look without changing the page.
 */
function WindowPreview({ mode }: { mode: Mode }) {
  const page = useResolvedMode();
  return (
    <span data-surface={mode === page ? undefined : 'inverted'} className="flex h-14 overflow-hidden rounded-md border border-line-subtle bg-backdrop p-1">
      <span className="flex w-1/4 flex-col gap-1 p-1">
        <span className="h-1.5 w-full rounded-full bg-primary" />
        <span className="h-1 w-4/5 rounded-full bg-neutral-secondary" />
        <span className="h-1 w-3/5 rounded-full bg-neutral-secondary" />
      </span>
      <span className="flex flex-1 flex-col gap-1 rounded-sm border border-line-subtle bg-panel p-1.5">
        <span className="h-1.5 w-1/2 rounded-full bg-[var(--ink)]" />
        <span className="h-1 w-5/6 rounded-full bg-neutral-secondary" />
        <span className="mt-auto h-2 w-1/3 rounded-sm bg-[var(--fill-accent)]" />
      </span>
    </span>
  );
}

function SystemPreview() {
  return (
    <span className="relative block h-14 overflow-hidden rounded-md">
      <span className="absolute inset-0 [clip-path:polygon(0_0,100%_0,0_100%)]">
        <WindowPreview mode="light" />
      </span>
      <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
        <WindowPreview mode="dark" />
      </span>
    </span>
  );
}

function Row({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 px-4 py-4 @lg:grid-cols-[14rem_1fr] @lg:gap-6">
      <div>
        <div className="text-sm font-medium text-ink">{title}</div>
        {description && <div className="mt-0.5 text-pretty text-xs leading-relaxed text-ink-secondary">{description}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function AppearanceSettings() {
  const p = usePreferences();
  const changed = JSON.stringify(p) !== JSON.stringify(DEFAULT_PREFERENCES);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-pretty text-sm text-ink-secondary">
          Make the factory look the way you like. It follows Synthesia's design system, and every change applies right away and stays on this browser.
        </p>
        <Button variant="outline" size="sm" icon={<RotateCcw />} disabled={!changed} onClick={() => preferences.reset()}>
          Reset to defaults
        </Button>
      </div>

      <Card>
        <CardHeader title="Theme" />
        <div className="divide-y divide-line-subtle">
          <Row title="Mode" description="System follows your operating system, and switches when it does.">
            <OptionCards<ModePreference>
              label="Mode"
              value={p.mode}
              onChange={(mode) => setPreferences({ mode })}
              options={[
                { value: 'system', label: 'Match the system', preview: <SystemPreview /> },
                { value: 'light', label: 'Light', preview: <WindowPreview mode="light" /> },
                { value: 'dark', label: 'Dark', preview: <WindowPreview mode="dark" /> },
              ]}
            />
          </Row>
          <Row title="Accent color" description="Selection, focus rings, links, charts and progress. Indigo is Synthesia's; the others are Framework 26 system ramps.">
            <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-3">
              {keysOf(ACCENTS).map((name) => {
                const selected = p.accent === name;
                return (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPreferences({ accent: name })}
                    className="group flex w-16 flex-col items-center gap-1.5 rounded-lg py-1"
                  >
                    <span
                      className={cn('grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-[var(--app-panel)] transition-shadow', selected ? 'ring-2 ring-[var(--line-accent)]' : 'group-hover:ring-2 group-hover:ring-line')}
                      style={{ background: `linear-gradient(135deg, ${accentColor(name, '400')}, ${accentColor(name, '700')})` } as CSSProperties}
                    >
                      {selected && <Check className="size-4 text-white" strokeWidth={3} />}
                    </span>
                    <span className={cn('text-xs', selected ? 'font-medium text-ink' : 'text-ink-secondary')}>{ACCENTS[name].label}</span>
                  </button>
                );
              })}
            </div>
          </Row>
          <Row title="Greys" description="The neutral tone of text, borders and surfaces.">
            <OptionCards<NeutralName>
              label="Greys"
              columns={2}
              value={p.neutral}
              onChange={(neutral) => setPreferences({ neutral })}
              options={keysOf(NEUTRALS).map((name) => ({
                value: name,
                label: NEUTRALS[name].label,
                description: name === 'cool' ? "Framework 26's navy-tinted greys" : 'The pure greys of the earlier design system',
                preview: (
                  <span className="flex h-6 overflow-hidden rounded-md">
                    {(['100', '300', '500', '700', '900'] as Step[]).map((s) => (
                      <span key={s} className="flex-1" style={{ background: neutralColor(name, s) }} />
                    ))}
                  </span>
                ),
              }))}
            />
          </Row>
          <Row title="Dark background" description="Only used in dark mode.">
            <OptionCards
              label="Dark background"
              columns={2}
              value={p.darkCanvas}
              onChange={(darkCanvas) => setPreferences({ darkCanvas })}
              options={keysOf(DARK_CANVASES).map((name) => ({
                value: name,
                label: DARK_CANVASES[name].label,
                description: name === 'ink' ? "Synthesia's deep ink, softer on the eyes" : "Framework 26's true black canvas",
                preview: <span className="block h-6 rounded-md border border-line-subtle" style={{ background: name === 'ink' ? NEUTRALS[p.neutral].ink : '#000000' }} />,
              }))}
            />
          </Row>
        </div>
      </Card>

      <Card>
        <CardHeader title="Text and spacing" />
        <div className="divide-y divide-line-subtle">
          <Row title="Text size" description="Everything scales with it, the way Framework 26 derives its type scale from one base size.">
            <OptionCards
              label="Text size"
              columns={4}
              value={p.text}
              onChange={(text) => setPreferences({ text })}
              options={keysOf(TEXT_SIZES).map((name) => ({
                value: name,
                label: TEXT_SIZES[name].label,
                description: `${TEXT_SIZES[name].px}px`,
                preview: (
                  <span className="heading block h-9 leading-9 text-ink" style={{ fontSize: TEXT_SIZES[name].px * 1.6 }}>
                    Aa
                  </span>
                ),
              }))}
            />
          </Row>
          <Row title="Density" description="Room between rows and inside controls: Framework 26's dense, default and comfort modifiers.">
            <OptionCards
              label="Density"
              value={p.density}
              onChange={(density) => setPreferences({ density })}
              options={keysOf(DENSITIES).map((name) => ({
                value: name,
                label: DENSITIES[name].label,
                preview: (
                  <span className="flex h-12 flex-col justify-center rounded-md bg-sunken px-2" style={{ gap: 6 * DENSITIES[name].modifier }}>
                    {[0, 1, 2].map((n) => (
                      <span key={n} className="h-1.5 rounded-full bg-neutral-secondary" style={{ width: `${90 - n * 18}%` }} />
                    ))}
                  </span>
                ),
              }))}
            />
          </Row>
          <Row title="Corners" description="Buttons use the base radius; cards and dialogs use larger steps of the same scale.">
            <OptionCards
              label="Corners"
              value={p.radius}
              onChange={(radius) => setPreferences({ radius })}
              options={keysOf(RADII).map((name) => ({
                value: name,
                label: RADII[name].label,
                description: `${RADII[name].px}px`,
                preview: (
                  <span className="flex h-10 items-center gap-2 px-1">
                    <span className="h-7 w-12 border-2 border-line-strong" style={{ borderRadius: RADII[name].px }} />
                    <span className="h-5 w-10 bg-primary" style={{ borderRadius: RADII[name].px * 0.75 }} />
                  </span>
                ),
              }))}
            />
          </Row>
          <Row
            title="Typeface"
            description={
              hasBasierSquare
                ? "Basier Square is Synthesia's typeface, loaded from your TTVPlatform checkout."
                : 'Basier Square loads from a TTVPlatform checkout next to this one; none was found, so Inter stands in.'
            }
          >
            <OptionCards
              label="Typeface"
              value={p.typeface}
              onChange={(typeface) => setPreferences({ typeface })}
              options={keysOf(TYPEFACES).map((name) => ({
                value: name,
                label: TYPEFACES[name].label,
                description: name === 'basier' && !hasBasierSquare ? 'Not found: Inter stands in' : undefined,
                preview: (
                  <span className="block truncate text-xl text-ink" style={{ fontFamily: `${TYPEFACES[name].sans}, "Inter Variable", system-ui`, letterSpacing: TYPEFACES[name].heading, fontWeight: 500 }}>
                    Factory 0123
                  </span>
                ),
              }))}
            />
          </Row>
        </div>
      </Card>

      <Card>
        <CardHeader title="Layout and detail" />
        <div className="divide-y divide-line-subtle">
          <Row title="Sidebar" description="Inverted paints the sidebar in the opposite mode: Framework 26 surface polarity.">
            <OptionCards
              label="Sidebar"
              columns={2}
              value={p.sidebar}
              onChange={(sidebar) => setPreferences({ sidebar })}
              options={(['default', 'inverted'] as const).map((s) => ({
                value: s,
                label: s === 'default' ? 'On the page' : 'Inverted',
                preview: (
                  <span className="flex h-12 gap-1 overflow-hidden rounded-md border border-line-subtle bg-backdrop p-1">
                    <span data-surface={s === 'inverted' ? 'inverted' : undefined} className="flex w-1/3 flex-col gap-1 rounded-sm bg-canvas p-1">
                      <span className="h-1.5 w-full rounded-full bg-primary" />
                      <span className="h-1 w-4/5 rounded-full bg-neutral-secondary" />
                      <span className="h-1 w-3/5 rounded-full bg-neutral-secondary" />
                    </span>
                    <span className="flex-1 rounded-sm border border-line-subtle bg-panel" />
                  </span>
                ),
              }))}
            />
          </Row>
          <Row title="Live panel detail" description="How much of each agent's work the live panel shows. You can also switch it in the panel.">
            <Segmented
              label="Live panel detail"
              value={p.activityDetail}
              onChange={(activityDetail) => setPreferences({ activityDetail })}
              options={[
                { value: 'summary', label: 'Summary', title: 'What the agents say and how each run ended' },
                { value: 'normal', label: 'Normal', title: 'Tool calls folded to one line each' },
                { value: 'verbose', label: 'Verbose', title: 'Every tool call and thought, open' },
              ]}
            />
            <p className="mt-2 text-xs text-ink-tertiary">
              {p.activityDetail === 'summary'
                ? 'Summary: what the agents say and how each run ended; their steps fold into one line.'
                : p.activityDetail === 'normal'
                  ? 'Normal: every message, with each tool call folded to one line you can open.'
                  : 'Verbose: every tool call and thought, open.'}
            </p>
          </Row>
          <Row title="Motion" description="System follows your operating system's reduce-motion setting.">
            <Segmented
              label="Motion"
              value={p.motion}
              onChange={(motion) => setPreferences({ motion })}
              options={[
                { value: 'system', label: 'Match the system' },
                { value: 'reduce', label: 'Reduced' },
                { value: 'full', label: 'Full' },
              ]}
            />
          </Row>
        </div>
        <div className="border-t border-line-subtle">
          <SwitchRow
            label="Color-code agents"
            description="Each kind of agent gets its own color in lists and the live panel. Off: neutral grey icons, so only status colors stand out."
            checked={p.agentColors}
            onChange={(agentColors) => setPreferences({ agentColors })}
          />
        </div>
      </Card>
    </div>
  );
}
