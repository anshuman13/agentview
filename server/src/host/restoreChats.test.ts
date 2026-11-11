import { describe, expect, it, vi } from 'bun:test';
import { Runs } from '../session/runs.js';

const mocks = { runs: new Runs(), open: vi.fn() };

vi.mock('node:fs/promises', () => ({
  readFile: async () => JSON.stringify({ chats: [{ sessionId: 'A', crons: [] }, { sessionId: 'B', crons: [] }] }),
  rm: async () => {},
}));
vi.mock('./listing.js', () => ({ runs: mocks.runs }));
vi.mock('./persist.js', () => ({ RESTORE: '/nowhere/restore.json', saveSoon: vi.fn() }));
vi.mock('./chats.js', () => ({ openSaved: mocks.open }));

const { restoreChats } = await import('./restoreChats.js');
const { live } = await import('./state.js');

describe('restoreChats', () => {
  it('keeps the job run of a chat that came back, rebinds it and ends the run of one that did not', async () => {
    const job = (sessionId: string) => mocks.runs.start({ kind: 'job', sessionId, chatId: 'old', title: 't', what: 'w', provider: 'claude' });
    const a = job('A');
    const b = job('B');
    mocks.open.mockImplementation(async (sessionId: string) => {
      if (sessionId === 'B') throw new Error('gone');
      const chat = { id: 'new', state: { session: { sessionId } }, wakeups: { restore() {} } };
      live.set('new', { chat: chat as never, watcher: { close() {} } });
      return chat;
    });
    await restoreChats();
    expect(mocks.runs.get(a)).toMatchObject({ state: 'running', chatId: 'new' });
    expect(mocks.runs.get(b)).toMatchObject({ state: 'done', why: 'AgentView restarted' });
  });

  it('keeps a job run waiting for review although its chat did not come back', async () => {
    const id = mocks.runs.start({ kind: 'job', sessionId: 'B', chatId: 'old', title: 't', what: 'w', provider: 'claude' });
    mocks.runs.update(id, { state: 'paused', why: 'Ready for review', review: 'pending' });
    await restoreChats();
    expect(mocks.runs.get(id)).toMatchObject({ state: 'paused', review: 'pending', needsYou: true });
  });
});
