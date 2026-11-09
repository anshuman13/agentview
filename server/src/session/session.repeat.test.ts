import { describe, expect, it, vi } from 'vitest';
import type { AgentSession } from './session.js';
import { claudeSession } from '../agent/claude/driver.js';
import { BIG_BRO, type ChatEvent } from '../../../shared/protocol.js';

function fakeSession() {
  const s = claudeSession('/tmp/project');
  const interrupt = vi.fn(async () => {});
  Object.assign(s.driver, { q: { interrupt } });
  const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
  const result = (uuid: string, subtype = 'success') => handle({ type: 'result', subtype, uuid, result: 'done', total_cost_usd: 0, is_error: subtype !== 'success' });
  return { s, interrupt, result, handle };
}

describe('/loop after Stop', () => {
  it('a back to back loop fires again after a grace period, not at once', async () => {
    vi.useFakeTimers();
    const { s, interrupt, result } = fakeSession();
    await s.prompt('/loop until 23:59 do the next round');
    expect(s.state.events.filter((e) => e.kind === 'user').map((e) => e.kind === 'user' && e.text)).toEqual(['/loop until 23:59 do the next round', 'do the next round']);
    Object.assign(s.driver, { inputQueue: [] });
    await s.interrupt();
    expect(interrupt).toHaveBeenCalledOnce();
    result('r1', 'error_during_execution');
    expect(s.state.session.running).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringMatching(/^Loop round 2 at \d\d:\d\d/) });
    vi.advanceTimersByTime(60_000);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(2);
    vi.advanceTimersByTime(61_000);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(3);
    expect(s.state.session.repeat?.round).toBe(2);
    vi.useRealTimers();
  });

  it('a round that ends at once does not spin the loop', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 3, 0, 0));
    const { s, result } = fakeSession();
    await s.prompt('/loop until 06:59 do the next round');
    const users = () => s.state.events.filter((e) => e.kind === 'user').length;
    expect(users()).toBe(2);
    result('r1');
    expect(s.state.session.running).toBe(false);
    expect(users()).toBe(2);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringMatching(/^Loop round 2 at 03:02/) });
    vi.advanceTimersByTime(2 * 60_000 + 1000);
    expect(users()).toBe(3);
    expect(s.state.session.repeat?.round).toBe(2);
    vi.useRealTimers();
  });

  it('a usage limit holds the loop until the reset time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 0, 0, 0));
    const { s, result, handle } = fakeSession();
    await s.prompt('/loop until 06:59 do the next round');
    handle({ type: 'assistant', parent_tool_use_id: null, error: 'rate_limit', message: { content: [{ type: 'text', text: "You've hit your session limit · resets 1:50am (Europe/Oslo)" }], usage: {} } });
    result('r1');
    expect(s.state.session.running).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Usage limit reached, loop round 2 at 01:51, /loop off to end it' });
    vi.advanceTimersByTime(110 * 60_000);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(2);
    vi.advanceTimersByTime(2 * 60_000);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(3);
    vi.useRealTimers();
  });

  it('a usage limit without a loop leaves a note, and /loop at sends the prompt once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 0, 0, 0));
    const { s, result, handle } = fakeSession();
    await s.prompt('do the next round');
    handle({ type: 'assistant', parent_tool_use_id: null, error: 'rate_limit', message: { content: [{ type: 'text', text: "You've hit your session limit · resets 1:50am (Europe/Oslo)" }], usage: {} } });
    result('r1');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Usage limit reached, resets at 01:51' });
    expect(s.state.session.repeat).toBeNull();
    await s.prompt('/loop at 01:51 do the next round');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Loop on, once at 01:51' });
    const prompts = () => s.state.events.filter((e) => e.kind === 'user' && e.text === 'do the next round').length;
    vi.advanceTimersByTime(110 * 60_000);
    expect(prompts()).toBe(1);
    vi.advanceTimersByTime(2 * 60_000);
    expect(prompts()).toBe(2);
    result('r2');
    expect(prompts()).toBe(2);
    expect(s.state.session.repeat).toBeNull();
    expect(s.state.events.some((e) => e.kind === 'system' && /^Loop finished at 01:51 after 1 round/.test(e.text))).toBe(true);
    vi.useRealTimers();
  });

  it('resumeRepeat with a past nextAt fires the next round now', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 3, 0, 0));
    const { s } = fakeSession();
    s.resumeRepeat({ prompt: 'do the next round', every: 10 * 60_000, until: null, round: 3, nextAt: Date.now() - 1000 });
    expect(s.state.events.map((e) => e.kind)).toEqual(['system', 'user']);
    expect(s.state.events[0]).toMatchObject({ kind: 'system', text: 'AgentView restarted, the loop continues every 10m' });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'user', text: 'do the next round', auto: 'loop', round: 4 });
    expect(s.state.session).toMatchObject({ running: true, repeat: { round: 4, nextAt: Date.now() + 10 * 60_000 } });
    vi.useRealTimers();
  });

  it('a tick that lands mid turn survives a CLI exit', async () => {
    vi.useFakeTimers();
    // Late in the evening the loop would reach its 23:59 end during the test.
    vi.setSystemTime(new Date('2026-10-15T12:00:00'));
    const { s, result } = fakeSession();
    await s.prompt('/loop 10m until 23:59 do the next round');
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(2);
    const priv = s.driver as unknown as { consume: () => Promise<void>; start: () => void };
    priv.consume();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state.session.running).toBe(false);
    vi.spyOn(priv, 'start').mockImplementation(() => {});
    vi.advanceTimersByTime(2 * 60_000 + 1);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(3);
    vi.useRealTimers();
    result('r9');
  });
});

describe('run controls', () => {
  const users = (s: AgentSession) => s.state.events.filter((e) => e.kind === 'user').length;

  it('a paused loop does not fire, stays paused through a restart and fires again on resume', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 3, 0, 0));
    const { s } = fakeSession();
    await s.prompt('/loop 10m until 23:59 do the next round');
    const run = s.state.session.repeat!.runId!;
    s.runControl(run, 'pause');
    expect(s.state.session.repeat?.paused).toBe(true);
    expect(s.runs.get(run)).toMatchObject({ state: 'paused', why: 'you paused it' });
    vi.advanceTimersByTime(30 * 60_000);
    expect(users(s)).toBe(2);
    const { s: again } = fakeSession();
    again.runs = s.runs;
    again.resumeRepeat({ ...s.state.session.repeat!, nextAt: Date.now() - 1000 });
    expect(users(again)).toBe(0);
    expect(again.state.session.repeat?.paused).toBe(true);
    expect(again.runs.get(run)?.state).toBe('paused');
    again.runControl(run, 'resume');
    expect(users(again)).toBe(1);
    expect(again.runs.get(run)).toMatchObject({ state: 'running', why: '' });
    vi.useRealTimers();
  });

  it('restore brings a stopped loop back with its run and round, only within 60 s', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 3, 0, 0));
    const { s } = fakeSession();
    await s.prompt('/loop 10m until 23:59 do the next round');
    const before = s.state.session.repeat!;
    s.runControl(before.runId!, 'stop');
    expect(s.state.session.repeat).toBeNull();
    expect(s.runs.get(before.runId)).toMatchObject({ state: 'done', why: 'you stopped it' });
    vi.advanceTimersByTime(30_000);
    s.runControl(before.runId!, 'restore');
    expect(s.state.session.repeat).toMatchObject({ runId: before.runId, round: before.round, every: before.every, until: before.until });
    expect(s.runs.get(before.runId)?.state).toBe('running');
    s.runControl(before.runId!, 'stop');
    vi.advanceTimersByTime(61_000);
    s.runControl(before.runId!, 'restore');
    expect(s.state.session.repeat).toBeNull();
    vi.useRealTimers();
  });

  it('a goal met ends the run with its round, so only the run end pushes', async () => {
    const { s, handle } = fakeSession();
    await s.prompt('/goal the tests pass');
    handle({ type: 'result', subtype: 'success', uuid: 'r1', result: 'All green. GOAL MET', total_cost_usd: 0, is_error: false });
    expect(s.roundNote).toMatchObject({ outcome: 'done', ends: true });
  });
});

describe('/goal', () => {
  const CHECK = 'Check whether this goal is met: the tests pass. Reply GOAL MET when it is, otherwise keep working on it.';
  const users = (s: AgentSession) => s.state.events.filter((e) => e.kind === 'user').map((e) => e.kind === 'user' && e.text);
  const reply = (s: AgentSession, uuid: string, text: string) => (s.driver as unknown as { handle: (m: unknown) => void }).handle({ type: 'result', subtype: 'success', uuid, result: text, total_cost_usd: 0, is_error: false });

  it('sends the check when idle and stops on GOAL MET', async () => {
    vi.useFakeTimers();
    const { s } = fakeSession();
    await s.prompt('/goal the tests pass');
    expect(users(s)).toEqual(['/goal the tests pass', CHECK]);
    expect(s.state.session.repeat).toMatchObject({ goal: 'the tests pass', round: 1, every: 0, until: null });
    reply(s, 'r1', 'Two tests fail, fixing them');
    expect(s.state.session.running).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringMatching(/^Goal check 2 at \d\d:\d\d, \/goal off to end it$/) });
    vi.advanceTimersByTime(2 * 60_000 + 1);
    expect(users(s)).toHaveLength(3);
    expect(s.state.session.repeat?.round).toBe(2);
    reply(s, 'r2', 'All green. GOAL MET');
    expect(s.state.session.repeat).toBeNull();
    expect(users(s)).toHaveLength(3);
    expect(s.state.events.some((e) => e.kind === 'system' && e.text === 'Goal met after 2 checks: the tests pass')).toBe(true);
    vi.useRealTimers();
  });

  it('gives up after 20 checks, and /goal off ends it early', async () => {
    vi.useFakeTimers();
    const { s } = fakeSession();
    await s.prompt('/goal the build is green');
    for (let i = 1; i < 20; i++) {
      reply(s, `r${i}`, 'still red');
      vi.advanceTimersByTime(2 * 60_000 + 1);
      expect(s.state.session.repeat?.round).toBe(i + 1);
    }
    reply(s, 'r20', 'still red');
    expect(s.state.session.repeat).toBeNull();
    expect(users(s)).toHaveLength(21);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Goal not met after 20 checks: the build is green' });
    await s.prompt('/goal ship it');
    expect(s.state.session.repeat?.goal).toBe('ship it');
    await s.prompt('/goal off');
    expect(s.state.session.repeat).toBeNull();
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Goal off' });
    expect(s.state.events.filter((e) => e.kind === 'system' && e.text === 'Goal on, checked whenever Claude goes idle until "ship it" is met, up to 20 checks')).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe('runs', () => {
  const reply = (handle: (m: unknown) => void, uuid: string, text: string, cost = 0, isError = false) => handle({ type: 'result', subtype: 'success', uuid, result: text, total_cost_usd: cost, is_error: isError });

  it('records two rounds and /loop off as one ended run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 3, 0, 0));
    const { s, handle } = fakeSession();
    const send = vi.spyOn(s.driver, 'send');
    await s.prompt('/loop 10m check the build');
    expect(send.mock.calls.at(-1)?.[0]).toMatch(/^check the build\n\n.*ROUND: <done\|progress/);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'user', text: 'check the build' });
    reply(handle, 'r1', 'Build is green.\nROUND: nothing', 0.1);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    reply(handle, 'r2', 'Fixed a test.\nROUND: progress fixed a flaky test', 0.3);
    await s.prompt('/loop off');
    expect(s.runs.list()).toHaveLength(1);
    const run = s.runs.list()[0];
    expect(run).toMatchObject({ kind: 'loop', what: 'check the build', state: 'done', why: 'you stopped it', round: 2, chatId: s.id });
    expect(run.costUsd).toBeCloseTo(0.3);
    expect(run.rounds.map((r) => [r.n, r.outcome, r.line, r.costUsd])).toEqual([[1, 'quiet', '', 0.1], [2, 'progress', 'fixed a flaky test', expect.closeTo(0.2)]]);
    expect(s.state.session.repeat).toBeNull();
    vi.useRealTimers();
  });

  it('a goal ends done when it is met, and a usage limit pauses the run until the next round', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 0, 0, 0));
    const { s, handle } = fakeSession();
    await s.prompt('/goal the tests pass');
    handle({ type: 'assistant', parent_tool_use_id: null, error: 'rate_limit', message: { content: [{ type: 'text', text: "You've hit your session limit · resets 1:50am" }], usage: {} } });
    reply(handle, 'r1', "You've hit your session limit · resets 1:50am", 0, true);
    expect(s.runs.list()[0]).toMatchObject({ state: 'paused', why: 'usage limit until 01:51', nextAt: Date.now() + 111 * 60_000 });
    expect(s.runs.list()[0].rounds[0].outcome).toBe('failed');
    vi.advanceTimersByTime(112 * 60_000);
    expect(s.runs.list()[0]).toMatchObject({ state: 'running', why: '', round: 2 });
    reply(handle, 'r2', 'All green. GOAL MET');
    expect(s.runs.list()[0]).toMatchObject({ kind: 'goal', state: 'done', why: 'goal met' });
    expect(s.runs.list()[0].rounds.map((r) => r.outcome)).toEqual(['failed', 'done']);
    vi.useRealTimers();
  });

  it('waits for approval while a permission is pending, and ends with the chat', async () => {
    vi.useFakeTimers();
    const { s } = fakeSession();
    vi.spyOn(s.driver, 'close').mockImplementation(() => {});
    await s.prompt('/loop 10m check the build');
    const ask = s.canUseTool('Bash', { command: 'ls' }, { signal: new AbortController().signal } as never);
    expect(s.runs.list()[0]).toMatchObject({ state: 'paused', why: 'waiting for your approval' });
    s.answerPermission(s.state.pending[0].id, true);
    await ask;
    expect(s.runs.list()[0]).toMatchObject({ state: 'running', why: '' });
    s.close();
    expect(s.runs.list()[0]).toMatchObject({ state: 'done', why: 'chat closed' });
    vi.useRealTimers();
  });

  it('a restored loop keeps its run and history and moves the run to the new chat', async () => {
    vi.useFakeTimers();
    const first = fakeSession();
    await first.s.prompt('/loop 10m check the build');
    reply(first.handle, 'r1', 'Nothing new.\nROUND: nothing');
    const repeat = first.s.state.session.repeat!;
    const second = fakeSession();
    second.s.runs = first.s.runs;
    second.s.resumeRepeat(repeat);
    expect(first.s.runs.list()).toHaveLength(1);
    expect(second.s.state.session.repeat?.runId).toBe(repeat.runId);
    expect(first.s.runs.get(repeat.runId)).toMatchObject({ chatId: second.s.id, state: 'running' });
    expect(first.s.runs.get(repeat.runId)?.rounds).toHaveLength(1);
    vi.useRealTimers();
  });

  it('a build cycle is one run with a round per step', async () => {
    const { s, handle } = fakeSession();
    Object.assign(s.driver, { q: { interrupt: vi.fn(), setModel: vi.fn(async () => {}), applyFlagSettings: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}) } });
    s.setLoop(true, 2);
    await s.prompt('add the thing');
    expect(s.runs.list()[0]).toMatchObject({ kind: 'cycle', what: 'add the thing', max: 2, state: 'running' });
    reply(handle, 'p1', 'Plan: change two files.');
    await vi.waitFor(() => expect(s.state.session.loop.phase).toBe('build'));
    reply(handle, 'b1', 'Built it.');
    await vi.waitFor(() => expect(s.state.session.loop.phase).toBe('test'));
    reply(handle, 't1', 'Checked.\nVERDICT: PASS', 0.5);
    const run = s.runs.list()[0];
    expect(run.rounds.map((r) => r.outcome)).toEqual(['progress', 'progress', 'done']);
    expect(run).toMatchObject({ state: 'done', why: 'the tester approved after 1 round' });
  });
});

// A seeded random walk over the send paths. Run with FUZZ_SEEDS=500 to hammer it.
describe('send queue fuzz', () => {
  const seeds = Number(process.env.FUZZ_SEEDS ?? 10);
  const base = Number(process.env.FUZZ_FROM ?? 1);
  type Priv = { queued: unknown[]; enqueue: (text: string) => void };
  type Drv = { q: { interrupt: () => Promise<void> } | null; inputQueue: unknown[]; consume: () => Promise<void>; start: () => void };

  function rng(seed: number) {
    let x = seed * 2654435761 + 1;
    return () => ((x = (x ^ (x << 13)) >>> 0), (x = (x ^ (x >>> 17)) >>> 0), (x = (x ^ (x << 5)) >>> 0), x / 2 ** 32);
  }

  for (let seed = base; seed < base + seeds; seed++) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed);
      const { s, interrupt, result } = fakeSession();
      const priv = s as unknown as Priv;
      const drv = s.driver as unknown as Drv;
      drv.start = () => {
        if (!drv.q) drv.q = { interrupt };
      };
      const sent: { id: string; text: string }[] = [];
      const dropped = new Set<string>();
      const started: string[] = [];
      const enqueue = priv.enqueue.bind(priv);
      priv.enqueue = (text: string) => {
        started.push(sent.find((m) => m.text === text)?.id ?? text);
        enqueue(text);
      };
      const idOf = (e: Extract<ChatEvent, { kind: 'user' }>) => sent.find((m) => m.id === e.id)?.id ?? e.text;
      const bigBro = () =>
        void (s.driver as unknown as { confirmBigBro: (i: unknown, sig: AbortSignal) => Promise<unknown> })
          .confirmBigBro({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: BIG_BRO, description: 'd', prompt: 'p' }, tool_use_id: `t${seed}-${n}` }, new AbortController().signal)
          .catch(() => {});
      let n = 0;
      const user = () => s.state.events.filter((e): e is Extract<ChatEvent, { kind: 'user' }> => e.kind === 'user');
      const trace: string[] = [];
      // Sent messages sit in the order Claude got them; waiting ones keep the order they were typed; nothing
      // is lost except what a Stop dropped, and a resend never doubles a message.
      const check = (op: string) => {
        trace.push(op);
        const info = () => `after ${trace.join(' > ')}`;
        const seen = user().map((e) => e.id);
        expect(new Set(seen).size, `duplicate user event ${info()}`).toBe(seen.length);
        expect(user().filter((e) => !e.queued).map(idOf), `sent order ${info()}`).toEqual(started);
        const waiting = sent.map((m) => m.id).filter((id) => !started.includes(id) && !dropped.has(id));
        expect(user().filter((e) => e.queued).map((e) => e.id), `queue order ${info()}`).toEqual(waiting);
        for (const e of user()) if (sent.some((m) => m.id === e.id)) expect(e.text, info()).toBe(sent.find((m) => m.id === e.id)?.text);
      };
      const queuedIds = () => (priv.queued as { id: string }[]).map((e) => e.id);
      for (let step = 0; step < 25; step++) {
        const roll = r();
        if (roll < 0.3) {
          const m = { id: `m${seed}-${++n}`, text: `msg ${n}` };
          sent.push(m);
          await s.prompt(m.text, m.id);
          check(`prompt ${m.id}`);
        } else if (roll < 0.5) {
          const m = { id: `m${seed}-${++n}`, text: `steer ${n}` };
          sent.push(m);
          await s.steer(m.text, m.id);
          check(`steer ${m.id}`);
        } else if (roll < 0.6 && sent.length) {
          const m = sent[Math.floor(r() * sent.length)];
          if (dropped.has(m.id)) continue;
          if (r() < 0.5) await s.prompt(m.text, m.id);
          else await s.steer(m.text, m.id);
          check(`resend ${m.id}`);
        } else if (roll < 0.7) {
          // The CLI has taken what was queued for it; a stop can now reach the running turn.
          if (r() < 0.5) drv.inputQueue = [];
          const q = s.state.session.running && !s.state.session.stopping ? queuedIds() : [];
          await s.interrupt();
          for (const id of q) dropped.add(id);
          check('interrupt');
        } else if (roll < 0.82) {
          // A turn only ends once every card is answered.
          if (s.state.session.running && !s.state.pending.length) result(`r${seed}-${step}`, r() < 0.3 ? 'error_during_execution' : 'success');
          check('result');
        } else if (roll < 0.87) {
          sent.push({ id: `c${seed}-${step}`, text: `/compact ${step}` });
          await s.prompt(`/compact ${step}`, `c${seed}-${step}`);
          check('compact');
        } else if (roll < 0.9) {
          // The CLI dies: queued input is lost, the events stay.
          drv.q = { ...drv.q, [Symbol.asyncIterator]: async function* () {} } as unknown as Drv['q'];
          await drv.consume();
          check('exit');
          expect(s.state.pending, `cards survived a CLI exit: ${trace.join(' > ')}`).toHaveLength(0);
        } else if (roll < 0.94) {
          if (s.state.session.running && !s.state.pending.length) bigBro();
          check('ask');
        } else if (roll < 0.97) {
          const card = s.state.pending[0];
          if (card) s.answerPermission(card.id, r() < 0.5);
          check('answer');
        } else {
          s.changePlan([`step ${step}`, 'then stop']);
          check('plan');
        }
      }
      for (let i = 0; i < 60 && (s.state.session.running || s.state.pending.length); i++) {
        for (const card of s.state.pending) s.answerPermission(card.id, false);
        if (s.state.session.running) result(`drain${i}`);
      }
      expect(s.state.pending, `cards left after draining: ${trace.join(' > ')}`).toHaveLength(0);
      expect(s.state.session.running, `still running after draining: ${trace.join(' > ')}`).toBe(false);
      expect(user().some((e) => e.queued), `queue not empty after draining: ${trace.join(' > ')}`).toBe(false);
    });
  }
});
