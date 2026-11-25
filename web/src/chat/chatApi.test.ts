import { describe, expect, it, vi } from 'bun:test';
import { stubGlobal } from '../../../testing';

vi.mock('../app/store', () => ({ api: (path: string) => path, getState: () => ({ session: { id: 'c1' } }), notice: () => {} }));
stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ error: 'Memory is off' }), { status: 500 })));

const { fetchMemory } = await import('./chatApi');

describe('fetchMemory', () => {
  it('rejects with the server error on a 500', async () => {
    let error = '';
    await fetchMemory().catch((e: Error) => { error = e.message; });
    expect(error).toBe('Memory is off');
  });
});

describe('sub-chat calls', () => {
  it('asks for the chain and a page of events with the session id', async () => {
    const urls: string[] = [];
    stubGlobal('fetch', (url: string) => { urls.push(url); return Promise.resolve(new Response('[]')); });
    const { fetchSubChats, fetchSubChatEvents } = await import('./chatApi');
    await fetchSubChats('a b');
    await fetchSubChatEvents('s1', 'e9', 50);
    expect(urls).toEqual(['/api/chat/subchats?session=a%20b', '/api/chat/subchat-events?session=s1&before=e9&limit=50']);
  });
});
