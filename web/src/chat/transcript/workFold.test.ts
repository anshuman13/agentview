import { describe, expect, it } from 'bun:test';
import { buildTranscript } from './steps';
import { foldTurns, workTitle, type FoldRow } from './workFold';
import type { ChatEvent } from '../../../../shared/protocol';

let n = 0;
const at = () => (n += 1000);
const user = (text: string): ChatEvent => ({ id: `u${at()}`, kind: 'user', text, at: n });
const say = (text: string): ChatEvent => ({ id: `a${at()}`, kind: 'assistant', text, streaming: false, at: n });
const tool = (name: string, input: Record<string, unknown> = {}): ChatEvent => ({ id: `t${at()}`, kind: 'tool_use', name, input, summary: name, at: n });
const result = (toolUseId: string, isError = false, text = 'ok'): ChatEvent => ({ id: `r${at()}`, kind: 'tool_result', toolUseId, text, isError, at: n });
const done = (costUsd: number): ChatEvent => ({ id: `d${at()}`, kind: 'result', text: '', costUsd, isError: false, at: n });
const fold = (events: ChatEvent[]): FoldRow[] => foldTurns(buildTranscript(events), events);
const kinds = (rows: FoldRow[]) => rows.map((r) => (r.kind === 'fold' ? 'fold' : r.it.kind));
const work = { tools: 12, files: 3, agents: 1, failed: 0, ms: 120_000, cost: 0.4 };

describe('workTitle', () => {
  it('lists tools, files, agents, duration and cost', () => {
    expect(workTitle(work, false, 'usd')).toEqual({ text: '12 tools · 3 files · 1 agent · 2m · $0.40', failed: '' });
  });

  it('omits zero parts, the cost of an unbilled chat and the duration while running', () => {
    expect(workTitle({ ...work, tools: 1, files: 0, agents: 0, cost: 0 }, false, 'usd').text).toBe('1 tool · 2m');
    expect(workTitle(work, true, 'plan').text).toBe('12 tools · 3 files · 1 agent');
  });

  it('returns the failed count apart', () => {
    expect(workTitle({ ...work, failed: 2 }, false, 'usd').failed).toBe('2 failed');
  });
});

describe('foldTurns', () => {
  it('moves steps and earlier text into one fold above the last reply', () => {
    const rows = fold([user('go'), say('looking'), tool('Bash'), say('done')]);
    expect(kinds(rows)).toEqual(['user', 'fold', 'assistant']);
    expect(rows[1]).toMatchObject({ kind: 'fold', last: true });
    expect((rows[1] as Extract<FoldRow, { kind: 'fold' }>).hidden.map((h) => h.kind)).toEqual(['assistant', 'step']);
  });

  it('puts the fold at the end of a turn that has no reply yet', () => {
    expect(kinds(fold([user('go'), tool('Bash')]))).toEqual(['user', 'fold']);
  });

  it('has no fold for a turn with nothing hidden, and folds each turn on its own', () => {
    const rows = fold([user('hi'), say('hello'), user('go'), tool('Bash'), say('done')]);
    expect(kinds(rows)).toEqual(['user', 'assistant', 'user', 'fold', 'assistant']);
    expect(rows.filter((r) => r.kind === 'fold').map((r) => r.kind === 'fold' && r.last)).toEqual([true]);
  });

  it('keeps blocked cards, error system rows and spec and sketch cards visible', () => {
    const spec = tool('Write', { file_path: '/w/.claude/specs/a.md', content: 'x' });
    const sketch = tool('Write', { file_path: '/w/.claude/sketches/a.html', content: 'x' });
    const events: ChatEvent[] = [
      user('go'), tool('Bash'),
      { id: 'b1', kind: 'blocked', at: 1 } as unknown as ChatEvent,
      { id: 's1', kind: 'system', text: 'Hook blocked Bash', error: true, at: 2 },
      { id: 's2', kind: 'system', text: 'Compact', at: 3 },
      spec, sketch, say('done'),
    ];
    expect(kinds(fold(events))).toEqual(['user', 'blocked', 'system', 'file', 'file', 'fold', 'assistant']);
  });

  it('counts tools, distinct files, agents and failures', () => {
    const bad = tool('Bash');
    const a = tool('Agent', { description: 'look' });
    const e1 = tool('Edit', { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' });
    const e2 = tool('Edit', { file_path: '/w/b.ts', old_string: 'a', new_string: 'b' });
    const denied = tool('Bash');
    const events = [user('go'), bad, result(bad.id, true, 'boom'), a, e1, result(e1.id), e2, result(e2.id), denied, result(denied.id, true, "The user doesn't want to proceed"), say('ok'), done(0.3), user('again'), say('hi'), done(0.5)];
    const first = fold(events).find((r) => r.kind === 'fold') as Extract<FoldRow, { kind: 'fold' }>;
    expect(first.work).toMatchObject({ tools: 5, files: 2, agents: 1, failed: 1 });
    expect(first.work.ms).toBe(events.find((e) => e.kind === 'result')!.at - events[0].at);
  });

  it('adds the rise over the previous loaded result, and none for the first loaded result', () => {
    const events = [user('go'), tool('Bash'), say('ok'), done(52), user('again'), tool('Bash'), say('hi'), done(52.3)];
    const costs = fold(events).flatMap((r) => (r.kind === 'fold' ? [r.work.cost] : []));
    expect(costs[0]).toBe(0);
    expect(costs[1]).toBeCloseTo(0.3);
  });
});
