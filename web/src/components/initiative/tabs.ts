import type { InitiativeDetail } from '@factory/shared';

const INITIATIVE_TABS = ['plan', 'tickets', 'conversation', 'rules', 'autopilot'] as const;
export type InitiativeTab = (typeof INITIATIVE_TABS)[number];

/** The tab an initiative opens on: the plan until it is approved, the tickets after. Open-PR initiatives have no plan. */
export function defaultTab(d: InitiativeDetail): InitiativeTab {
  if (d.initiative.kind === 'open-prs') return 'tickets';
  return d.initiative.approvedAt ? 'tickets' : 'plan';
}

export function tabsFor(d: InitiativeDetail): InitiativeTab[] {
  return d.initiative.kind === 'open-prs' ? INITIATIVE_TABS.filter((t) => t !== 'plan') : [...INITIATIVE_TABS];
}
