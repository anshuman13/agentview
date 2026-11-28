import { describe, expect, it } from 'bun:test';
import { CodexDriver, userInput } from './driver.js';
import { codexThread } from './threads.js';
import { waitFor } from '../../../../testing.js';

function setup(running: boolean, steer: () => Promise<unknown>) {
  const calls: Array<{ method: string; params: any }> = [];
  const started: string[] = [];
  const results: unknown[] = [];
  const host: any = { cwd: '/tmp', state: { session: { running, permissionMode: 'default' } }, turnStarted: (why: string) => void started.push(why), turnResult: (r: unknown) => void results.push(r), system: () => undefined };
  const d: any = new CodexDriver(host);
  d.ready = Promise.resolve();
  d.threadId = 't1';
  d.turnId = 'turn1';
  d.rpc = {
    request: async (method: string, params: any) => {
      calls.push({ method, params });
      if (method === 'turn/steer') return steer();
      return { turn: { id: 'turn2' } };
    },
  };
  return { d, calls, started, results };
}

describe('deliver', () => {
  it('starts a turn with the same text when the steer fails', async () => {
    const { d, calls, results } = setup(true, () => Promise.reject(new Error('no active turn')));
    await d.deliver('hello', true);
    expect(calls.map((c) => c.method)).toEqual(['turn/steer', 'turn/start']);
    expect(calls[1].params.input[0].text).toBe('hello');
    expect(results).toEqual([]);
  });
  it('marks a steered message as taken once the steer is accepted', async () => {
    const { d, calls } = setup(true, () => Promise.resolve({}));
    const taken: string[] = [];
    d.host.taken = (id: string) => void taken.push(id);
    await d.deliver('hello', true, false, d.stops, 'm1');
    expect(calls.map((c) => c.method)).toEqual(['turn/steer']);
    expect(taken).toEqual(['m1']);
    expect(d.read('m1')).toBe(true);
    expect(d.read('m2')).toBe(false);
  });
  it('reports the turn only when it started one while the chat was idle', async () => {
    const idle = setup(false, () => Promise.reject(new Error('gone')));
    await idle.d.deliver('hi', true);
    expect(idle.started).toEqual(['Codex started a turn for your message']);
    const busy = setup(true, () => Promise.reject(new Error('gone')));
    await busy.d.deliver('hi', true);
    expect(busy.started).toEqual([]);
  });
  it('reports an error result only when turn/start fails', async () => {
    const { d, results } = setup(true, () => Promise.resolve());
    d.rpc.request = async () => Promise.reject(new Error('boom'));
    await d.deliver('hi', false);
    expect(results).toMatchObject([{ ok: false, text: 'boom' }]);
  });
  it('drops a prompt that Stop came before, and interrupts one whose turn was starting', async () => {
    const early = setup(false, () => Promise.resolve());
    early.d.turnId = null;
    const stops = early.d.stops;
    await early.d.interrupt();
    await early.d.deliver('hi', false, false, stops);
    expect(early.calls).toEqual([]);
    expect(early.results).toMatchObject([{ ok: false, text: 'Stopped' }]);
    const starting = setup(false, () => Promise.resolve());
    starting.d.turnId = null;
    const request = starting.d.rpc.request;
    starting.d.rpc.request = async (method: string, params: any) => {
      const r = await request(method, params);
      if (method === 'turn/start') starting.d.stops++;
      return r;
    };
    await starting.d.deliver('hi', false);
    expect(starting.calls.map((c) => c.method)).toEqual(['turn/start', 'turn/interrupt']);
  });
  it('records the title of a new thread once its id is known', async () => {
    const { d } = setup(false, () => Promise.resolve());
    d.turnId = null;
    d.threadId = undefined;
    let resolve!: () => void;
    d.ready = new Promise<void>((r) => (resolve = r));
    d.start = () => undefined;
    d.send('first prompt');
    d.threadId = 't9';
    resolve();
    await d.queue;
    await waitFor(async () => expect((await codexThread('t9'))?.summary).toBe('first prompt'));
  });
  it('keeps the current turn when an older turn completes', () => {
    const { d } = setup(true, () => Promise.resolve());
    d.stream = { handle: () => undefined };
    d.onNotification('turn/completed', { turn: { id: 'old' } });
    expect(d.turnId).toBe('turn1');
    d.onNotification('turn/completed', { turn: { id: 'turn1' } });
    expect(d.turnId).toBe(null);
  });
});

describe('userInput', () => {
  it('sends image markers as local images in order', () => {
    expect(userInput('look [Image: /tmp/a.png]\n[Image: /tmp/b.png] and this')).toEqual([
      { type: 'text', text: 'look ', text_elements: [] },
      { type: 'localImage', path: '/tmp/a.png' },
      { type: 'localImage', path: '/tmp/b.png' },
      { type: 'text', text: ' and this', text_elements: [] },
    ]);
    expect(userInput('plain')).toEqual([{ type: 'text', text: 'plain', text_elements: [] }]);
  });
  it('steers with the same input', async () => {
    const { d, calls } = setup(true, () => Promise.resolve());
    await d.deliver('[Image: /tmp/a.png]', true);
    expect(calls[0].params.input).toEqual([{ type: 'localImage', path: '/tmp/a.png' }]);
  });
});

describe('start', () => {
  it('takes over the process that read the history instead of starting another', async () => {
    const calls: string[] = [];
    const host: any = { cwd: '/tmp', state: { session: { id: 'c1', running: false, permissionMode: 'default' } }, setSession: () => undefined, system: () => undefined };
    const d: any = new CodexDriver(host);
    d.threadId = 't1';
    const spare: any = {
      adopt: () => spare,
      initialize: async () => void calls.push('initialize'),
      request: async (method: string) => {
        calls.push(method);
        if (method === 'account/read') return { account: {}, requiresOpenaiAuth: false };
        if (method === 'thread/resume') return { thread: { id: 't1' }, model: 'gpt-5' };
        return {};
      },
      close: () => undefined,
    };
    d.spare = spare;
    d.start();
    await d.ready.catch(() => undefined);
    expect(d.rpc).toBe(spare);
    expect(calls).not.toContain('initialize');
    expect(calls.slice(0, 2)).toEqual(['account/read', 'thread/resume']);
    d.close();
  });
});

describe('clear', () => {
  it('starts a new thread, takes its id and ends the turn', async () => {
    const { d, calls, results } = setup(false, () => Promise.resolve());
    const sessions: unknown[] = [];
    d.host.setSession = (s: unknown) => void sessions.push(s);
    d.start = () => undefined;
    d.rpc.request = async (method: string, params: any) => {
      calls.push({ method, params });
      return { thread: { id: 't2' }, model: 'gpt-5' };
    };
    d.clear();
    await d.queue;
    expect(calls.map((c) => c.method)).toEqual(['thread/start']);
    expect(d.threadId).toBe('t2');
    expect(sessions).toEqual([{ sessionId: 't2' }]);
    expect(results).toMatchObject([{ ok: true, isError: false }]);
  });
});
