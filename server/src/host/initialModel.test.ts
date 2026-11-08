import { describe, expect, it } from 'vitest';
import { applyInitialModel } from './initialModel.js';

const fake = () => {
  const calls: string[] = [];
  const notes: string[] = [];
  return { calls, notes, chat: { setModel: async (m: string) => void calls.push(m), system: (t: string) => void notes.push(t) } };
};

describe('applyInitialModel', () => {
  it('sets the chosen model', () => {
    const f = fake();
    applyInitialModel(f.chat, ' opus ');
    expect(f.calls).toEqual(['opus']);
  });

  it('ignores a missing or blank model', () => {
    const f = fake();
    applyInitialModel(f.chat, undefined);
    applyInitialModel(f.chat, '  ');
    expect(f.calls).toEqual([]);
  });

  it('reports a failure in the chat', async () => {
    const notes: string[] = [];
    applyInitialModel({ setModel: async () => { throw new Error('nope'); }, system: (t) => void notes.push(t) }, 'x');
    await new Promise((r) => setTimeout(r, 0));
    expect(notes).toEqual(['Could not set the model: nope']);
  });
});
