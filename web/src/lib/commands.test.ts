import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterCommands } from './commands';

const items = [
  { group: 'Initiatives', label: 'Usage breakdown per video' },
  { group: 'Initiatives', label: 'Return each row from /usage-breakdown' },
  { group: 'Initiatives', label: 'Salesforce provisioning', keywords: 'EnactServices' },
  { group: 'Go to', label: 'Usage' },
  { group: 'Go to', label: 'Settings' },
  { group: 'Actions', label: 'Customize appearance', keywords: 'theme accent density' },
];
const labels = (q: string, idle?: number) => filterCommands(items, q, idle).map((i) => i.label);

describe('filterCommands', () => {
  it('shows the first items of each group when there is no query', () => {
    assert.deepEqual(labels('', 1), ['Usage breakdown per video', 'Usage', 'Customize appearance']);
  });

  it('puts the exact match first, with its group ahead of the rest', () => {
    assert.deepEqual(labels('usage'), ['Usage', 'Usage breakdown per video', 'Return each row from /usage-breakdown']);
  });

  it('needs every word of the query, and searches keywords too', () => {
    assert.deepEqual(labels('enact sales'), ['Salesforce provisioning']);
    assert.deepEqual(labels('theme'), ['Customize appearance']);
    assert.deepEqual(labels('usage settings'), []);
  });
});
