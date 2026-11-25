import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SEMANTIC_COLORS, STEPS, SYNTHESIA_RAMPS, SYSTEM_RAMPS, TONES, toneStep } from './tokens';

const resolvable = (ref: string) => {
  if (['white', 'black', 'seed'].includes(ref)) return true;
  const [first, ...rest] = ref.split('.');
  if (first === 'system') return rest[0] in SYSTEM_RAMPS && (STEPS as readonly string[]).includes(rest[1]);
  return first in SYNTHESIA_RAMPS && (STEPS as readonly string[]).includes(rest[0]);
};

describe('design tokens', () => {
  it('gives every semantic colour all four Framework 26 cells, each naming a real ramp step', () => {
    for (const [name, cells] of Object.entries(SEMANTIC_COLORS)) {
      for (const ref of [cells.light, cells.dark, cells.invertedLight, cells.invertedDark]) assert.ok(resolvable(ref), `${name}: ${ref}`);
    }
  });

  it('matches the Synthesia theme values Framework 26 generates', () => {
    assert.equal(SYNTHESIA_RAMPS.accent[SEMANTIC_COLORS['fill-accent'].light.split('.')[1] as '600'], '#3f59de');
    assert.equal(SYNTHESIA_RAMPS.accent[SEMANTIC_COLORS['line-focus'].dark.split('.')[1] as '300'], '#aea9f1');
    assert.equal(SYNTHESIA_RAMPS.neutral[SEMANTIC_COLORS['ink-secondary'].light.split('.')[1] as '600'], '#606680');
  });

  it("reads a tone's overrides before the shared steps", () => {
    assert.equal(toneStep('good', 'ink', 'light'), '600');
    assert.equal(toneStep('good', 'solid', 'light'), '400');
    assert.equal(toneStep('neutral', 'ink', 'dark'), '300');
    assert.equal(toneStep('warn', 'solid', 'dark'), '200');
  });

  it('builds every tone from a ramp that exists', () => {
    for (const { ramp } of Object.values(TONES)) {
      const [first, name] = ramp.split('.');
      assert.ok(first === 'system' ? name in SYSTEM_RAMPS : first in SYNTHESIA_RAMPS, ramp);
    }
  });
});
