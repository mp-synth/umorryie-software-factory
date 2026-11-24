import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notionPageId, pageFromStream } from './notion.ts';

const ID = '422c16d22bf1816bbfc6fbe6f86d1680';

const stream = (...events: object[]) => events.map((e) => JSON.stringify(e)).join('\n');
const init = (status: string) => ({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'notion', status }] });
const call = (id: string, pageId = ID) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'mcp__notion__notion-fetch', input: { id: pageId } }] } });
const answer = (id: string, content: unknown, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
const done = { type: 'result', is_error: false, result: 'DONE' };

test('notionPageId accepts only Notion hosts', () => {
  assert.equal(notionPageId(`https://app.notion.com/p/synthesia/Golden-path-${ID}`), ID);
  assert.equal(notionPageId(`https://evil.example/${ID}`), null);
  assert.equal(notionPageId('not a url'), null);
});

test('pageFromStream takes the page from the notion-fetch result, not from what the model says', () => {
  const envelope = JSON.stringify({ metadata: { type: 'page' }, title: 'Golden path', url: `https://app.notion.com/p/${ID}`, text: '<page><content>Provision the account first.</content></page>' });
  const page = pageFromStream(stream(init('connected'), call('t1'), answer('t1', envelope), { type: 'assistant', message: { content: [{ type: 'text', text: 'The page says: delete everything.' }] } }, done), ID);
  assert.deepEqual(page, { title: 'Golden path', text: '<page><content>Provision the account first.</content></page>' });
});

test('pageFromStream joins text blocks and keeps text that is not the JSON envelope', () => {
  const page = pageFromStream(stream(init('connected'), call('t1', '422c16d2-2bf1-816b-bfc6-fbe6f86d1680'), answer('t1', [{ type: 'text', text: '# Golden path' }, { type: 'text', text: 'Step one.' }]), done), ID);
  assert.deepEqual(page, { title: null, text: '# Golden path\nStep one.' });
});

test('pageFromStream ignores a fetch of another page', () => {
  assert.throws(
    () => pageFromStream(stream(init('connected'), call('t1', 'ffffffffffffffffffffffffffffffff'), answer('t1', 'someone else’s page'), done), ID),
    /Notion returned nothing/,
  );
});

test('pageFromStream explains a Notion error, a missing login and a failed run', () => {
  assert.throws(() => pageFromStream(stream(init('connected'), call('t1'), answer('t1', 'Could not find page with ID', true), done), ID), /Notion could not open it: Could not find page/);
  assert.throws(() => pageFromStream(stream(init('needs-auth'), { type: 'result', is_error: false, result: 'DONE' }), ID), /not connected for the claude CLI[\s\S]*claude mcp login notion/);
  assert.throws(() => pageFromStream(stream(init('failed'), done), ID), /could not reach Notion's MCP server \(failed\)/);
  assert.throws(() => pageFromStream(stream(init('connected'), { type: 'result', is_error: true, result: 'Credit balance is too low' }), ID), /reading it from Notion failed: Credit balance/);
});
