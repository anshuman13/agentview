import { describe, expect, it } from 'bun:test';
import { CodexDriver } from './driver.js';
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

describe('inject', () => {
  it('steers the running turn with the text', async () => {
    const { d, calls } = setup(true, () => Promise.resolve());
    expect(await d.inject('plan changed')).toBe(true);
    expect(calls).toMatchObject([{ method: 'turn/steer', params: { expectedTurnId: 'turn1', input: [{ text: 'plan changed' }] } }]);
  });
  it('is refused when no turn is running or the steer misses', async () => {
    const idle = setup(false, () => Promise.resolve());
    idle.d.turnId = null;
    expect(await idle.d.inject('x')).toBe(false);
    expect(await setup(true, () => Promise.reject(new Error('gone'))).d.inject('x')).toBe(false);
  });
});

describe('deliver', () => {
  it('starts a turn with the same text when the steer fails', async () => {
    const { d, calls, results } = setup(true, () => Promise.reject(new Error('no active turn')));
    await d.deliver('hello', true);
    expect(calls.map((c) => c.method)).toEqual(['turn/steer', 'turn/start']);
    expect(calls[1].params.input[0].text).toBe('hello');
    expect(results).toEqual([]);
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
