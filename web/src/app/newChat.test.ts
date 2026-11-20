import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { stubGlobal } from '../../../testing';

const data = new Map<string, string>();
stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
stubGlobal('document', { title: '', hidden: false, addEventListener: () => {} });
const send = vi.fn();
const prompt = vi.fn();
vi.mock('./store/send', () => ({ send, prompt }));
const { appSettings } = await import('./appSettings');
const { getState, set } = await import('./store/core');
const { modelGroup, rememberModel, rememberModels, startChat, startModel, startProvider } = await import('./newChat');

const options = [
  { id: 'claude', label: 'Claude', modelSet: 'claude', enabled: true },
  { id: 'openrouter', label: 'OpenRouter', modelSet: 'claude', enabled: true },
  { id: 'codex', label: 'Codex', modelSet: 'codex', enabled: true },
] as const;
const models = (...values: string[]) => values.map((value) => ({ value, displayName: value }));

describe('start model', () => {
  beforeEach(() => { data.clear(); appSettings.patch({ providers: [...options], defaultProvider: 'claude' }); });

  it('shares one model set between Claude and OpenRouter', () => {
    expect(modelGroup('openrouter', [...options])).toBe('claude');
    expect(modelGroup('codex', [...options])).toBe('codex');
    expect(modelGroup(undefined, [])).toBe('claude');
  });

  it('keeps a last model per set and sends it only while the set lists it', () => {
    rememberModels('claude', models('opus', 'sonnet'));
    rememberModels('codex', models('gpt-5'));
    rememberModel('claude', 'sonnet');
    rememberModel('codex', 'gpt-5');
    expect(startModel()).toBe('sonnet');
    expect(startModel('openrouter')).toBe('sonnet');
    expect(startModel('codex')).toBe('gpt-5');
    rememberModels('claude', models('opus'));
    expect(startModel()).toBeUndefined();
  });

  it('follows the default provider when none is named', () => {
    rememberModels('codex', models('gpt-5'));
    rememberModel('codex', 'gpt-5');
    appSettings.patch({ defaultProvider: 'codex' });
    expect(startModel()).toBe('gpt-5');
  });

  it('starts on the default provider while it is enabled, else the first enabled one', () => {
    expect(startProvider('codex', [...options])).toBe('codex');
    expect(startProvider('codex', [{ ...options[0], enabled: false }, options[1], { ...options[2], enabled: false }])).toBe('openrouter');
    expect(startProvider('codex', [])).toBe('codex');
  });
});

describe('startChat', () => {
  const chat = (id: string) => ({ id }) as never;
  const view = (id: string) => set((s) => ({ session: { ...s.session, id } }));
  beforeEach(() => {
    send.mockClear();
    prompt.mockClear();
    set({ session: { ...getState().session, id: 'a' }, live: [chat('a'), chat('b')], events: [] });
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('sets the mode and sends the first message only in a chat that was not open before', () => {
    startChat({ text: 'hi' }, { label: 'Plan first', mode: 'plan' });
    view('b');
    expect(send).toHaveBeenCalledTimes(1);
    view('c');
    expect(send).toHaveBeenLastCalledWith({ type: 'set_permission_mode', mode: 'plan' });
    expect(prompt).toHaveBeenCalledWith('hi', expect.any(Function));
    vi.advanceTimersByTime(30_000);
    expect(getState().events).toEqual([]);
  });

  it('says the chat did not open after 30 s', () => {
    startChat({ text: 'hi' }, { label: 'Plan first', mode: 'plan' });
    vi.advanceTimersByTime(30_000);
    view('c');
    expect(prompt).not.toHaveBeenCalled();
    expect(getState().events.map((e) => (e as { text?: string }).text)).toEqual(['The chat did not open']);
  });
});
