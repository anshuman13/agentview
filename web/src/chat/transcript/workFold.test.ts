import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildTranscript, createTranscriptBuilder, docCards, specCards } from './steps';
import { createFoldBuilder, foldTurns, workTitle, type FoldRow } from './workFold';
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
    expect(workTitle(work, false, 'usd')).toEqual({ text: '12 tools · 3 files · 1 agent · 2m · $0.40', failed: '', detail: '' });
  });

  it('omits zero parts, the cost of an unbilled chat and the duration while running', () => {
    expect(workTitle({ ...work, tools: 1, files: 0, agents: 0, cost: 0 }, false, 'usd').text).toBe('1 tool · 2m');
    expect(workTitle(work, true, 'plan').text).toBe('12 tools · 3 files · 1 agent');
  });

  it('returns the failed count apart', () => {
    expect(workTitle({ ...work, failed: 2 }, false, 'usd').failed).toBe('2 failed');
  });

  it('moves agents, duration and cost into the detail on a narrow screen', () => {
    expect(workTitle({ ...work, failed: 4, tools: 18 }, false, 'usd', true)).toEqual({ text: '18 tools · 3 files', failed: '4 failed', detail: '1 agent · 2m · $0.40' });
    expect(workTitle({ ...work, tools: 0, agents: 0, note: 'Session started with claude' }, false, 'usd', true)).toEqual({ text: 'Session started with claude', failed: '', detail: '' });
    expect(workTitle({ ...work, agents: 0, ms: 0, cost: 0 }, false, 'usd', true).detail).toBe('');
  });
});

describe('createFoldBuilder', () => {
  const setup = () => {
    const build = createTranscriptBuilder();
    const folds = createFoldBuilder();
    return (events: ChatEvent[]) => folds(build(events), events);
  };

  it('keeps every earlier row when a token lands in the last reply', () => {
    const run = setup();
    const t = tool('Bash');
    const first = [user('one'), t, say('a'), user('two'), tool('Bash')];
    const reply = say('b');
    const before = run([...first, reply]);
    const after = run([...first, { ...reply, text: 'bc' }]);
    expect(after.length).toBe(before.length);
    after.slice(0, -1).forEach((r, i) => expect(r).toBe(before[i]));
  });

  it('replaces the former last fold when a prompt follows it and keeps the others', () => {
    const run = setup();
    const events = [user('one'), tool('Bash'), say('a'), user('two'), tool('Bash'), say('b')];
    const before = run(events);
    const after = run([...events, user('three')]);
    const folds = (rows: FoldRow[]) => rows.filter((r) => r.kind === 'fold');
    expect(folds(after)[0]).toBe(folds(before)[0]);
    expect(folds(after)[1]).not.toBe(folds(before)[1]);
    expect(folds(after)[1]).toMatchObject({ last: false });
  });

  it('gives the rows foldTurns gives', () => {
    const events = [user('one'), tool('Bash'), say('a'), user('two'), tool('Bash')];
    const items = buildTranscript(events);
    expect(createFoldBuilder()(items, events)).toEqual(foldTurns(items, events));
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

describe('claims read', () => {
  const claims = (events: ChatEvent[]) => (fold(events).find((r) => r.kind === 'fold') as Extract<FoldRow, { kind: 'fold' }>).claims;
  const search = tool('mcp__agentview__wiki_search', { query: 'q' });
  const page = tool('mcp__agentview__wiki_page', { id: 'p1' });
  const text = ['- page [p1] Notes (Work, live)', '- [c1] (2026-11-01, live) Uses bun (on Notes / Tools)', '- [c2] (undated, proposed) Prefers (short) replies'].join('\n');

  it('lists claim lines once per id, with their page, and skips page lines', () => {
    const events = [user('go'), search, result(search.id, false, text), page, result(page.id, false, '# Notes\n## Tools\n- [c1] (2026-11-01, live) Uses bun (on Notes / Tools)'), say('ok')];
    expect(claims(events)).toEqual([
      { id: 'c1', text: 'Uses bun', where: 'Notes / Tools' },
      { id: 'c2', text: 'Prefers (short) replies', where: '' },
    ]);
  });

  it('has none for no match, an error or another tool', () => {
    const none = tool('mcp__agentview__wiki_search');
    const bad = tool('mcp__agentview__wiki_page');
    const other = tool('Bash');
    expect(claims([user('go'), none, result(none.id, false, 'Nothing matches.'), bad, result(bad.id, true, text), other, result(other.id, false, text), say('ok')])).toEqual([]);
  });
});

describe('remembered', () => {
  it('holds the memory file a Write in the server history wrote', () => {
    const events: ChatEvent[] = JSON.parse(readFileSync(new URL('../../../../shared/fixtures/remembered-history.json', import.meta.url), 'utf8'));
    const items = buildTranscript(events);
    const rows = foldTurns(items, events, new Set([...specCards(items), ...docCards(items)]));
    expect(rows.flatMap((r) => (r.kind === 'fold' ? [r.remembered] : []))).toEqual([['/Users/x/.claude-alt/projects/-Users-x-repo/memory/prefs.md']]);
  });
});
