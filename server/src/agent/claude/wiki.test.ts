import { afterEach, expect, test, vi } from 'vitest';
import { wikiTools } from './wiki.js';

afterEach(() => vi.unstubAllGlobals());

const search = async (query: string) => {
  const tool = wikiTools({ cwd: '/tmp', chat: () => null }).find((t) => t.name === 'wiki_search')!;
  const out = await tool.handler({ query, profile: 'work' }, {});
  return (out.content[0] as { text: string }).text;
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('wiki_search lists current claims before old ones and marks the old block', async () => {
  const claims = [
    { id: 'old', text: 'Limit is 30', at: Date.now(), state: 'live', superseded_by: 'new', page_id: 'p' },
    { id: 'new', text: 'Limit is 60', at: Date.now(), state: 'live', superseded_by: null, page_id: 'p' },
  ];
  vi.stubGlobal('fetch', vi.fn(async () => json(200, { pages: [], claims })));
  const text = await search('limit');
  expect(text.indexOf('[new]')).toBeGreaterThan(-1);
  expect(text.indexOf('[new]')).toBeLessThan(text.indexOf('may be out of date'));
  expect(text.indexOf('may be out of date')).toBeLessThan(text.indexOf('[old]'));
});

test('wiki_search reports a hub error and a failed fetch', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(400, { error: 'Missing or invalid profile' })));
  expect(await search('limit')).toBe('Wiki search failed: Missing or invalid profile');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  expect(await search('limit')).toBe('Wiki search failed: offline');
});
