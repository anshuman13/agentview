import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'bun:test';
import { givenPreferences, type Preference } from '../../../../shared/preferences.js';
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

test('wiki_search marks a contested claim with its note', async () => {
  const claims = [
    { id: 'c1', text: 'Limit is 60', at: Date.now(), state: 'live', page_id: 'p', contested: JSON.stringify({ by: 'you', at: 1, note: 'now 100' }) },
    { id: 'c2', text: 'Limit is 70', at: Date.now(), state: 'live', page_id: 'p', contested: 'not json' },
    { id: 'c3', text: 'Limit is 80', at: Date.now(), state: 'live', page_id: 'p', contested: null },
  ];
  stubGlobal('fetch', vi.fn(async () => json(200, { pages: [], claims })));
  const text = await search('limit');
  expect(text).toContain(', contested: now 100) Limit is 60');
  expect(text).toContain(', contested: no note) Limit is 70');
  expect(text).not.toMatch(/\[c3\].*contested/);
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

test('wiki_propose saves nothing for a rejected, narrow, already proposed or live claim', async () => {
  const day = 86_400_000;
  const fact = (id: string, profile: string, state: string, text: string, updated_at = 1) => ({ table: 'facts', id, profile, deleted: false, updated_at, fields: { text, state } });
  const changes = [
    fact('rej10', 'work', 'rejected', 'The gateway limits each user to 60 requests a minute', Date.now() - 10 * day),
    fact('rej100', 'work', 'rejected', 'The importer retries failed uploads five times daily', Date.now() - 100 * day),
    fact('rejOther', 'personal', 'rejected', 'Deploys happen every Friday afternoon', Date.now() - day),
    fact('prop', 'work', 'proposed', 'Billing runs on the first of the month'),
    fact('live', 'work', 'live', 'Search results are cached for ten minutes'),
  ];
  const pushed: unknown[] = [];
  stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') pushed.push(JSON.parse(String(init.body)));
    return json(200, { version: 1, hasMore: false, changes: init?.method === 'POST' ? [] : changes });
  }));
  expect(await propose('Gateway limits every user to 60 requests per minute')).toBe('Not proposed: Like a rejected claim. Do not propose it again.');
  expect(await propose('The importer retries failed uploads five times daily')).toBe('Not proposed: Like a rejected claim. Do not propose it again.');
  expect(await propose('Keep the intro short in this deck')).toBe('Not proposed: Too narrow. Do not propose it again.');
  expect(await propose('Deploys happen every Friday afternoon')).toMatch(/^Proposed /);
  expect(await propose('  billing RUNS on  the first of the month ')).toBe('Already proposed as [prop].');
  expect(await propose('Search results are cached for ten minutes')).toBe('Already live as [live].');
  expect(await propose('Search results are cached for ten minutes, per user')).toContain('Similar to [live]');
  expect(pushed).toHaveLength(2);
});

test('wiki_propose files under a near-title live page and never onto a rejected one', async () => {
  const page = (id: string, title: string, state: string) => ({ table: 'pages', id, profile: 'work', deleted: false, updated_at: 1, fields: { title, state } });
  const pushed: { table: string; id: string; fields: Record<string, unknown> }[][] = [];
  stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') pushed.push(JSON.parse(String(init.body)).changes ?? JSON.parse(String(init.body)));
    return json(200, { version: 1, hasMore: false, changes: init?.method === 'POST' ? [] : [page('p1', 'Importer', 'live'), page('p2', 'Billing', 'rejected')] });
  }));
  const on = (title: string) => wikiProposeTool.handler({ text: 'As of 20 Nov 2026, the importer runs nightly', sources: [], page: title, section: 'Systems', profile: 'work' }, { cwd: '/tmp', chatId: 'c1', provider: 'claude', host: { setStatus: () => undefined, goal: () => false } });
  expect(await on('The Importers')).toContain('Filed under existing page Importer.');
  expect(pushed.at(-1)!.map((c) => c.table)).toEqual(['facts']);
  expect(pushed.at(-1)![0]!.fields.page_id).toBe('p1');
  expect(await on('Importer')).not.toContain('Filed under');
  await on('Billing');
  expect(pushed.at(-1)!.map((c) => c.table)).toEqual(['pages', 'facts']);
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

test('wiki_search sends only live claims to the hub as used', async () => {
  const claims = [
    { id: 'l', text: 'Live one', at: Date.now(), state: 'live', superseded_by: null },
    { id: 'n', text: 'No state', at: Date.now(), state: null, superseded_by: null },
    { id: 'p', text: 'Proposed one', at: Date.now(), state: 'proposed', superseded_by: null },
    { id: 'r', text: 'Rejected one', at: Date.now(), state: 'rejected', superseded_by: null },
  ];
  const f = vi.fn(async (url: string | URL | Request) => (String(url).includes('/wiki/search') ? json(200, { pages: [], claims }) : json(200, { used: 2 })));
  stubGlobal('fetch', f);
  await search('one');
  const post = f.mock.calls.find((c) => String(c[0]).includes('/wiki/used'))!;
  expect(JSON.parse((post[1] as RequestInit).body as string).ids).toEqual(['l', 'n']);
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
    fact('disputed', { text: 'Disputed one', contested: '{"by":"you","at":1,"note":"no"}' }),
    fact('other', { text: 'Personal one' }, 'personal'),
  ];
  stubGlobal('fetch', vi.fn(async () => json(200, { version: 2, hasMore: false, changes })));
  preferencesText('/tmp');
  await hubRows('facts');
  const lines = preferencesText('/tmp').split('\n');
  expect(lines[0]).toBe('The user\'s approved preferences:');
  expect(lines.slice(1, 4)).toEqual(['- Preference 0', '- Preference 1', '- Preference 2']);
  expect(lines).toHaveLength(16);
  expect(lines.join('\n')).not.toMatch(/On a page|Superseded|Old one|Proposed|Disputed|Personal/);
});

test('givenPreferences follows the shared cases', () => {
  const cases = JSON.parse(readFileSync(new URL('../../../../shared/fixtures/preferences.json', import.meta.url), 'utf8')) as { name: string; profile: string; now: number; facts: Preference[]; expected: string[] }[];
  for (const c of cases) expect(givenPreferences(c.facts, c.profile, c.now).map((f) => f.id), c.name).toEqual(c.expected);
});

test('wiki_propose reads a bracketed replaces id and refuses one that replaces nothing', async () => {
  const fact = (id: string, profile: string, fields = {}) => ({ table: 'facts', id, profile, deleted: false, updated_at: 1, fields: { text: `Claim ${id} about gateways`, state: 'live', ...fields } });
  const changes = [fact('live1', 'work'), fact('gone', 'work', { superseded_by: 'live1' }), fact('mine', 'personal'), fact('idea', 'work', { state: 'proposed' })];
  const pushed: { changes: { fields: Record<string, unknown> }[] }[] = [];
  stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') pushed.push(JSON.parse(String(init.body)));
    return json(200, { version: 1, hasMore: false, changes: init?.method === 'POST' ? [] : changes });
  }));
  const replace = (replaces: string, text = 'Brand new unrelated claim') => wikiProposeTool.handler({ text, sources: [], replaces, profile: 'work' }, { cwd: '/tmp', chatId: 'c1', provider: 'claude', host: { setStatus: () => undefined, goal: () => false } });
  expect(await replace('live1')).toStartWith('Proposed [');
  expect(await replace('[live1]')).toStartWith('Proposed [');
  expect(pushed.map((p) => p.changes[0]!.fields.replaces)).toEqual(['live1', 'live1']);
  for (const id of ['nope', 'gone', 'mine', 'idea']) expect(await replace(`[${id}]`)).toBe(`No live claim [${id}] to replace. Call wiki_search for its id, or leave replaces out.`);
  expect(await replace('nope', 'Claim live1 about gateways today')).toContain('Similar to [live1]: Claim live1 about gateways.');
  expect(pushed).toHaveLength(2);
});

test('preferencesText is empty and does not throw while the hub is unreachable', async () => {
  stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  expect(() => preferencesText('/tmp')).not.toThrow();
});
