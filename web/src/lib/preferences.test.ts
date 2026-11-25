import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PREFERENCES, parsePreferences, resolveMode, rootAttributes } from './preferences';

describe('parsePreferences', () => {
  it('falls back to the defaults for nothing stored', () => {
    assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
    assert.deepEqual(parsePreferences('not an object'), DEFAULT_PREFERENCES);
  });

  it('keeps valid choices and drops unknown or mistyped ones', () => {
    const p = parsePreferences({ accent: 'teal', density: 'huge', text: 'xl', agentColors: 'yes', notifications: true, typeface: 'comic-sans' });
    assert.equal(p.accent, 'teal');
    assert.equal(p.density, DEFAULT_PREFERENCES.density);
    assert.equal(p.text, 'xl');
    assert.equal(p.agentColors, DEFAULT_PREFERENCES.agentColors);
    assert.equal(p.notifications, true);
    assert.equal(p.typeface, DEFAULT_PREFERENCES.typeface);
  });

  it('carries over the light or dark choice stored before preferences existed', () => {
    assert.equal(parsePreferences(null, 'light').mode, 'light');
    assert.equal(parsePreferences({ mode: 'dark' }, 'light').mode, 'dark');
    assert.equal(parsePreferences(null, 'sepia').mode, 'system');
  });
});

describe('rootAttributes', () => {
  it('resolves System to the operating system mode', () => {
    assert.equal(rootAttributes(DEFAULT_PREFERENCES, true).mode, 'dark');
    assert.equal(rootAttributes(DEFAULT_PREFERENCES, false).mode, 'light');
    assert.equal(resolveMode('light', true), 'light');
  });

  it('names every choice the token CSS reads', () => {
    const attrs = rootAttributes({ ...DEFAULT_PREFERENCES, accent: 'orange', darkCanvas: 'black', radius: 'round' }, false);
    assert.deepEqual(attrs, {
      mode: 'light',
      accent: 'orange',
      neutral: 'cool',
      canvas: 'black',
      density: 'default',
      text: 'md',
      radius: 'round',
      typeface: 'basier',
      motion: 'system',
    });
  });
});
