import { describe, expect, it } from 'vitest';
import { CodexDriver } from './driver.js';

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
});

describe('capabilities', () => {
  it('has no subagents', () => {
    expect(setup(false, () => Promise.resolve()).d.capabilities.subagents).toBe(false);
  });
});
