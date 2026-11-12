import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildPrompt } from '../../../../shared/specTasks';
import { stubGlobal } from '../../../../testing';

const store = { running: false, pending: 0 };
const prompt = vi.fn();
const queueNext = vi.fn();
const steer = vi.fn();
const notice = vi.fn();

const real = await import('../../app/store');
vi.mock('../../app/store', () => ({
  ...real,
  prompt,
  queueNext,
  steer,
  notice,
  useStore: (pick: (s: unknown) => unknown) => pick({ session: { running: store.running }, pending: new Array(store.pending).fill(0) }),
}));
stubGlobal('localStorage', { getItem: () => null, setItem() {} });

const { useSubmit } = await import('./useSubmit');
const { withUses } = await import('./composerLogic');

function build(text: string, over: { uploading?: number; uses?: { server: string }[] } = {}) {
  const calls = { applied: null as string | null, history: null as string[] | null, uses: null as unknown[] | null };
  const Harness = () => {
    const { sendBuild } = useSubmit({
      text, setText: () => {}, shell: text.startsWith('!'), uploading: over.uploading ?? 0, uses: over.uses ?? [],
      setUses: (u) => { calls.uses = u; }, sentHistory: ['old'], setSentHistory: (h) => { calls.history = h; }, clearHistoryStep: () => {}, apply: (n) => { calls.applied = n; },
    });
    sendBuild();
    return null;
  };
  renderToStaticMarkup(<Harness />);
  return calls;
}

describe('sendBuild', () => {
  beforeEach(() => {
    store.running = false;
    store.pending = 0;
    for (const f of [prompt, queueNext, steer, notice]) f.mockClear();
  });

  it('sends the build prompt of the trimmed brief with its uses and empties the composer', () => {
    const uses = [{ server: 'linear' }];
    const calls = build('  add a toggle \n', { uses });
    expect(prompt.mock.calls[0][0]).toBe(buildPrompt(withUses('add a toggle', uses)));
    expect(calls.history).toEqual(['old', 'add a toggle']);
    expect(calls.applied).toBe('');
    expect(calls.uses).toEqual([]);
  });

  it('queues while running, even with a pending permission, and never steers', () => {
    store.running = true;
    store.pending = 1;
    build('add a toggle');
    expect(queueNext).toHaveBeenCalledTimes(1);
    expect(steer).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('sends a brief starting with ! as a prompt', () => {
    build('!ls');
    expect(prompt.mock.calls[0][0]).toBe(buildPrompt('!ls'));
  });

  it('sends nothing and shows a notice for an empty brief or an upload in progress', () => {
    const empty = build('  ');
    expect(notice).toHaveBeenLastCalledWith('Type the brief in the composer first');
    build('brief', { uploading: 1 });
    expect(notice).toHaveBeenLastCalledWith('Wait for the upload to finish');
    expect(prompt).not.toHaveBeenCalled();
    expect(queueNext).not.toHaveBeenCalled();
    expect(empty.applied).toBeNull();
  });
});
