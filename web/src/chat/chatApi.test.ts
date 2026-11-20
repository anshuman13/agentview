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
