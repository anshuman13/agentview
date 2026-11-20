import { afterEach, expect, test, vi } from 'bun:test';
import { hubRows } from '../../integrations/assistant.js';
import { preferencesText, wikiProposeTool, wikiSearchTool } from './wiki.js';
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

test('preferencesText lists the profile\'s live Memory claims newest first, capped at 15', async () => {
  const now = Date.now();
  const fact = (id: string, fields: Record<string, unknown>, profile = 'work') => ({ table: 'facts', id, profile, deleted: false, updated_at: 2, fields: { state: 'live', at: now, ...fields } });
  const changes = [
    ...Array.from({ length: 20 }, (_, i) => fact(`p${i}`, { text: `Preference ${i}`, at: now - i * 1000 })),
    fact('paged', { text: 'On a page', page_id: 'pg' }),
    fact('gone', { text: 'Superseded one', superseded_by: 'p0' }),
    fact('old', { text: 'Old one', at: now - 100 * 86_400_000 }),
    fact('proposed', { text: 'Proposed one', state: 'proposed' }),
    fact('other', { text: 'Personal one' }, 'personal'),
  ];
  stubGlobal('fetch', vi.fn(async () => json(200, { version: 2, hasMore: false, changes })));
  preferencesText('/tmp');
  await hubRows('facts');
  const lines = preferencesText('/tmp').split('\n');
  expect(lines[0]).toBe('The user\'s approved preferences:');
  expect(lines.slice(1, 4)).toEqual(['- Preference 0', '- Preference 1', '- Preference 2']);
  expect(lines).toHaveLength(16);
  expect(lines.join('\n')).not.toMatch(/On a page|Superseded|Old one|Proposed|Personal/);
});

test('preferencesText is empty and does not throw while the hub is unreachable', async () => {
  stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  expect(() => preferencesText('/tmp')).not.toThrow();
});
