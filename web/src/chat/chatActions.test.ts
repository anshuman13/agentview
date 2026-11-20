import { beforeEach, describe, expect, it, vi } from 'bun:test';

const editRow = vi.fn();
const restoreMemory = vi.fn();
let undo: (() => void) | undefined;
const snacks: string[] = [];
vi.mock('../app/store', () => ({ embedded: false, getState: () => ({ session: { id: 'c', cwd: '/Users/x/workspace/p' }, live: [] }), notice: vi.fn(), prompt: vi.fn(), send: vi.fn(), setUi: vi.fn(), subscribe: vi.fn() }));
vi.mock('./composer/composerLogic', () => ({ chatMarkdown: vi.fn(), handoffText: vi.fn(), lastReply: vi.fn(), replyNote: vi.fn() }));
vi.mock('../codex/data', () => ({ assistantStore: () => ({ snapshot: () => ({ facts: [] }), editRow }) }));
vi.mock('../codex/view', () => ({ copyText: vi.fn(), showSnack: (text: string, u?: () => void) => { snacks.push(text); undo = u; } }));
vi.mock('./chatApi', () => ({ removeMemory: async () => ({ raw: 'x', lines: [] }), restoreMemory }));
const { moveMemoryToWiki } = await import('./chatActions');

const file = { path: '/m/a.md', name: 'a', description: 'A rule', text: 'Use bun', at: 0 };
const deleted = () => editRow.mock.calls.some((c) => (c[2] as { deleted?: number }).deleted === 1);

describe('moveMemoryToWiki', () => {
  beforeEach(() => { editRow.mockClear(); snacks.length = 0; });

  it('deletes the claim only once Undo has restored the memory', async () => {
    restoreMemory.mockImplementation(async () => ({}));
    const restored = vi.fn();
    expect(await moveMemoryToWiki(file, restored)).toBe(true);
    undo!();
    expect(deleted()).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(deleted()).toBe(true);
    expect(restored).toHaveBeenCalled();
  });

  it('keeps the claim when the restore fails', async () => {
    restoreMemory.mockImplementation(async () => { throw new Error('down'); });
    await moveMemoryToWiki(file, vi.fn());
    undo!();
    await Promise.resolve();
    await Promise.resolve();
    expect(deleted()).toBe(false);
    expect(snacks.at(-1)).toBe('Could not restore the memory');
  });
});
