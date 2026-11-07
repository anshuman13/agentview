import { describe, expect, it, vi } from 'vitest';
import { applyHubChanges, assistantRoute, type HubRow } from './assistant.js';

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
  it('forwards GET /debug to the hub', async () => {
    const fetchMock = vi.fn(async () => new Response('{"debug":true}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await assistantRoute('GET', new URL('http://x/api/assistant/debug'), async () => '');
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/\/debug$/);
  });

  it('forwards GET /history with who encoded', async () => {
    const fetchMock = vi.fn(async () => new Response('{"replies":[]}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await assistantRoute('GET', new URL('http://x/api/assistant/history?who=A%20B'), async () => '');
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/\/history\?who=A%20B$/);
  });

  it('forwards full on GET /changes', async () => {
    const fetchMock = vi.fn(async () => new Response('{"changes":[]}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await assistantRoute('GET', new URL('http://x/api/assistant/changes?since=5&full=1'), async () => '');
    vi.unstubAllGlobals();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/\/changes\?since=5&full=1$/);
  });
});
