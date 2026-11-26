import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatCheckPolicy, parseCheckPolicy, type CheckRule } from '@factory/shared';

describe('check policy text', () => {
  it('round-trips reserved separators inside the check-name pattern', () => {
    const rules: CheckRule[] = [{ class: 'fix', pattern: '^Build when deployed :: canary$' }];
    assert.deepEqual(parseCheckPolicy(formatCheckPolicy(rules)), { rules, errors: [] });
  });

  it('round-trips reserved separators inside the log pattern', () => {
    const rules: CheckRule[] = [
      {
        class: 'waiting-on',
        pattern: '^API contracts$',
        logPattern: 'generated when backend is ready :: version [0-9]+',
        note: 'wait for publication',
      },
    ];
    assert.deepEqual(parseCheckPolicy(formatCheckPolicy(rules)), { rules, errors: [] });
  });

  it('round-trips reserved separators inside the note', () => {
    const rules: CheckRule[] = [{ class: 'people-only', pattern: '^Review$', note: 'owner :: security' }];
    assert.deepEqual(parseCheckPolicy(formatCheckPolicy(rules)), { rules, errors: [] });
  });

  it('keeps the existing unquoted policy syntax', () => {
    assert.deepEqual(parseCheckPolicy('people-only ^Meticulous :: a visual diff'), {
      rules: [{ class: 'people-only', pattern: '^Meticulous', note: 'a visual diff' }],
      errors: [],
    });
  });
});
