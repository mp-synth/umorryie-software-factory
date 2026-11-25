import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DOCK_DEFAULT_WIDTH, DOCK_MIN_WIDTH, parseLayout } from './layout';

describe('parseLayout', () => {
  it('starts with the sidebar open, Done folded and the live panel open', () => {
    assert.deepEqual(parseLayout(null), { sidebarCollapsed: false, foldedGroups: ['done'], dockOpen: true, dockWidth: DOCK_DEFAULT_WIDTH, initiativeView: 'cards' });
  });

  it('keeps the live panel width the old panel prefs stored, within bounds', () => {
    assert.equal(parseLayout(null, { dockOpen: false, dockWidth: 720 }).dockOpen, false);
    assert.equal(parseLayout(null, { dockWidth: 720 }).dockWidth, 720);
    assert.equal(parseLayout({ dockWidth: 10 }).dockWidth, DOCK_MIN_WIDTH);
    assert.equal(parseLayout({ dockWidth: 'wide' }).dockWidth, DOCK_DEFAULT_WIDTH);
  });

  it('drops folded groups that are not names', () => {
    assert.deepEqual(parseLayout({ foldedGroups: ['idle', 3, null] }).foldedGroups, ['idle']);
  });
});
