import { describe, expect, it, vi } from 'bun:test';
import os from 'node:os';
import { advisorsMac, applyHubChanges, assistantRoute, learnEvents, type HubRow } from './assistant.js';
import { expandHome, homeRelative } from '../settings.js';
import { stubGlobal, unstubAllGlobals } from '../../../testing.js';

const change = (id: string, deleted = false) => ({ table: 'items', id, profile: 'work' as const, deleted, updated_at: 1, fields: { title: id } });

describe('applyHubChanges', () => {
  it('removes a row once a change deletes it', () => {
    const rows = new Map<string, Map<string, HubRow>>();
    applyHubChanges(rows, [change('a'), change('b')]);
    expect(rows.get('items')?.size).toBe(2);
    applyHubChanges(rows, [change('a', true)]);
    expect([...rows.get('items')!.keys()]).toEqual(['work:b']);
  });
});

describe('assistantRoute', () => {
  it('drops query params a route does not list', async () => {
    const fetchMock = vi.fn(async () => new Response('{"replies":[]}', { headers: { 'content-type': 'application/json' } }));
    stubGlobal('fetch', fetchMock);
    await assistantRoute('GET', new URL('http://x/api/assistant/history?who=A%20B&extra=1'), async () => '');
    unstubAllGlobals();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/\/history\?who=A%20B$/);
  });

  it('returns 404 without fetching for an unknown route or method', async () => {
    const fetchMock = vi.fn();
    stubGlobal('fetch', fetchMock);
    const unknown = await assistantRoute('GET', new URL('http://x/api/assistant/nope'), async () => '');
    const wrongMethod = await assistantRoute('GET', new URL('http://x/api/assistant/sync'), async () => '');
    unstubAllGlobals();
    expect(unknown.status).toBe(404);
    expect(wrongMethod.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('learnEvents', () => {
  it('keeps the last 60 user and assistant messages, each cut to 2000 characters', () => {
    const events = Array.from({ length: 100 }, (_, i) => ({ id: `e${i}`, kind: i % 3 === 0 ? ('tool_use' as const) : ('user' as const), text: 'x'.repeat(3000), at: i, name: 'Bash', input: {}, summary: '' }));
    const out = learnEvents(events as never);
    expect(out).toHaveLength(60);
    expect(out.every((e) => e.kind === 'user' && e.text.length === 2000)).toBe(true);
    expect(out.at(-1)?.id).toBe('e98');
  });
});

describe('advisorsMac', () => {
  it('is null for a local hub and the AgentView address of a remote one', () => {
    expect(advisorsMac('http://localhost:7790')).toBeNull();
    expect(advisorsMac('http://127.0.0.1:7790/')).toBeNull();
    expect(advisorsMac('http://hub.example.com:7790')).toBe('http://hub.example.com:7777');
  });

  it('sends paths under home relative to it and expands them back', () => {
    const home = os.homedir();
    expect(homeRelative(`${home}/code/app`)).toBe('~/code/app');
    expect(homeRelative(`${home}x/app`)).toBe(`${home}x/app`);
    expect(expandHome('~/code/app')).toBe(`${home}/code/app`);
    expect(expandHome('/srv/~/app')).toBe('/srv/~/app');
  });
});
