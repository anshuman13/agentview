import { afterEach, expect, test, vi } from 'bun:test';
import { wikiProposeTool, wikiSearchTool } from './wiki.js';
import { stubGlobal, unstubAllGlobals } from '../../../../testing.js';

afterEach(() => unstubAllGlobals());

const search = (query: string) => wikiSearchTool.handler({ query, profile: 'work' }, { cwd: '/tmp', chatId: null, provider: 'claude', host: { setStatus: () => undefined, goal: () => false } });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('wiki_search lists current claims before old ones and marks the old block', async () => {
  const claims = [
    { id: 'old', text: 'Limit is 30', at: Date.now(), state: 'live', superseded_by: 'new', page_id: 'p' },
    { id: 'new', text: 'Limit is 60', at: Date.now(), state: 'live', superseded_by: null, page_id: 'p' },
  ];
  stubGlobal('fetch', vi.fn(async () => json(200, { pages: [], claims })));
  const text = await search('limit');
  expect(text.indexOf('[new]')).toBeGreaterThan(-1);
  expect(text.indexOf('[new]')).toBeLessThan(text.indexOf('may be out of date'));
  expect(text.indexOf('may be out of date')).toBeLessThan(text.indexOf('[old]'));
});

test('wiki_search reports a hub error and a failed fetch', async () => {
  stubGlobal('fetch', vi.fn(async () => json(400, { error: 'Missing or invalid profile' })));
  expect(await search('limit')).toBe('Wiki search failed: Missing or invalid profile');
  stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  expect(await search('limit')).toBe('Wiki search failed: offline');
});

const propose = (text: string, profile: 'work' | 'personal' = 'work') => wikiProposeTool.handler({ text, sources: [], profile }, { cwd: '/tmp', chatId: 'c1', provider: 'claude', host: { setStatus: () => undefined, goal: () => false } });

test('wiki_propose names a similar live or proposed claim of the same profile and still saves', async () => {
  const fact = (id: string, profile: string, state: string, text: string, extra = {}) => ({ table: 'facts', id, profile, deleted: false, updated_at: 1, fields: { text, state, ...extra } });
  const changes = [
    fact('live1', 'work', 'live', 'The gateway limits each user to 60 requests a minute'),
    fact('mine', 'personal', 'live', 'Deploys happen every Friday afternoon'),
    fact('gone', 'work', 'live', 'Deploys happen every Friday afternoon', { superseded_by: 'live1' }),
  ];
  const pushed: unknown[] = [];
  stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') pushed.push(JSON.parse(String(init.body)));
    return json(200, { version: 1, hasMore: false, changes: init?.method === 'POST' ? [] : changes });
  }));
  expect(await propose('Gateway limits every user to 60 requests per minute')).toContain('Similar to [live1]: The gateway limits each user to 60 requests a minute. Pass replaces if it updates that claim.');
  expect(await propose('Deploys happen every Friday afternoon')).not.toContain('Similar to');
  expect(await propose('Brand new unrelated claim')).toMatch(/^Proposed \[[^\]]+\] for the user to approve in memory\.$/);
  expect(pushed).toHaveLength(3);
});

test('wiki_search tells the hub which claims it showed and keeps a recently used old claim current', async () => {
  const day = 86_400_000;
  const claims = [
    { id: 'a', text: 'Used a lot', at: Date.now() - 200 * day, used_at: Date.now() - day, state: 'live', superseded_by: null },
    { id: 'b', text: 'Dead', at: Date.now() - 200 * day, state: 'live', superseded_by: null },
  ];
  const f = vi.fn(async (url: string | URL | Request) => (String(url).includes('/wiki/search') ? json(200, { pages: [], claims }) : json(200, { used: 2 })));
  stubGlobal('fetch', f);
  const text = await search('used');
  expect(text.indexOf('[a]')).toBeLessThan(text.indexOf('may be out of date'));
  expect(text.indexOf('may be out of date')).toBeLessThan(text.indexOf('[b]'));
  const post = f.mock.calls.find((c) => String(c[0]).includes('/wiki/used'))!;
  expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ profile: 'work', ids: ['a'] });
});
