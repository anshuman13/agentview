import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'bun:test';
import { Explored } from './Transcript';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildTranscript, createTranscriptBuilder, duration, exploreLabel, exploreRuns, specCards, stepLabel, stepTone, newMarker, newReplies, dayDividers, type Item } from './steps';
import { replyLine, sumEdits } from '../../../../shared/edits';
import { buildTurns } from './turns';
import { chatLine } from '../../sessions/folders';
import type { ChatEvent, LiveChat } from '../../../../shared/protocol';

let n = 0;
const at = () => ++n;
const tool = (name: string, input: Record<string, unknown>): ChatEvent => ({ id: `t${at()}`, kind: 'tool_use', name, input, summary: name, at: n });
const result = (toolUseId: string, text = 'ok', isError = false): ChatEvent => ({ id: `r${at()}`, kind: 'tool_result', toolUseId, text, isError, at: n });
const say = (text: string): ChatEvent => ({ id: `a${at()}`, kind: 'assistant', text, streaming: false, at: n });
const user = (text: string): ChatEvent => ({ id: `u${at()}`, kind: 'user', text, at: n });
const edit = (file: string, oldText: string, newText: string) => tool('Edit', { file_path: file, old_string: oldText, new_string: newText });
const cwd = '/w/app';

describe('automatic prompts', () => {
  it('turn into compact labelled items instead of user bubbles', () => {
    const loop: ChatEvent = { id: 'l1', kind: 'user', text: 'check the build\nthen report', at: 1, auto: 'loop', round: 3 };
    const goal: ChatEvent = { id: 'g1', kind: 'user', text: 'Check whether this goal is met', at: 2, auto: 'goal', round: 2 };
    expect(buildTranscript([loop, goal, user('hi')]).map((i) => i.kind === 'auto' ? i.label : i.kind)).toEqual(['Loop round 3 · check the build', 'Goal round 2', 'user']);
  });
});

describe('stepLabel', () => {
  it('names the verb and the object, with paths relative to the project', () => {
    expect(stepLabel('Read', { file_path: '/w/app/src/a.ts' }, cwd)).toEqual({ verb: 'Read', object: 'src/a.ts' });
    expect(stepLabel('Grep', { pattern: 'foo', path: '/w/app/src' }, cwd)).toEqual({ verb: 'Searched', object: '"foo" in src' });
    expect(stepLabel('Grep', { pattern: 'foo', path: '/w/app' }, cwd).object).toBe('"foo" in the project');
    expect(stepLabel('Glob', { pattern: '**/*.ts', path: '/w/app/src' }, cwd).object).toBe('src/**/*.ts');
    expect(stepLabel('LS', { path: '/w/app/src' }, cwd)).toEqual({ verb: 'Listed', object: 'src/' });
    expect(stepLabel('Bash', { command: 'npm test\necho done' }, cwd)).toEqual({ verb: 'Ran', object: 'npm test', mono: true });
    expect(stepLabel('Bash', { command: 'npm test', description: 'Run the unit tests' }, cwd)).toEqual({ verb: '', object: 'Run the unit tests', cmd: 'npm test' });
    expect(stepLabel('WebFetch', { url: 'https://example.com/' }, cwd)).toEqual({ verb: 'Fetched', object: 'example.com' });
    expect(stepLabel('Write', { file_path: '/elsewhere/x.md' }, cwd)).toEqual({ verb: 'Wrote', object: '/elsewhere/x.md' });
  });

  it('names MCP tools by tool and server and falls back to the tool name', () => {
    expect(stepLabel('mcp__playwright__browser_click', {}, cwd)).toEqual({ verb: 'Called', object: 'browser_click (playwright)' });
    expect(stepLabel('Mystery', {}, cwd)).toEqual({ verb: 'Used', object: 'Mystery' });
  });
});

describe('duration', () => {
  it('rounds to seconds, minutes or hours and hides sub-second steps', () => {
    expect(duration(400)).toBe('');
    expect(duration(6400)).toBe('6s');
    expect(duration(125_000)).toBe('2m');
    expect(duration(7_200_000)).toBe('2h');
  });
});

describe('buildTranscript', () => {
  it('merges consecutive edits of the same file and sums their counts', () => {
    const e1 = edit('/w/app/a.ts', 'x', 'y\nz');
    const e2 = edit('/w/app/a.ts', '', 'w');
    const items = buildTranscript([user('go'), e1, result(e1.id), e2, result(e2.id), say('Done')]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'file', 'assistant']);
    expect(items[1]).toMatchObject({ kind: 'file', path: '/w/app/a.ts', count: { add: 3, del: 1 } });
  });

  it('keeps edits apart when another step or file sits between them', () => {
    const items = buildTranscript([edit('/w/app/a.ts', 'x', 'y'), tool('Read', { file_path: '/w/app/b.ts' }), edit('/w/app/a.ts', 'x', 'y'), edit('/w/app/b.ts', '', 'q')]);
    expect(items.map((i) => i.kind)).toEqual(['file', 'step', 'file', 'file']);
  });

  it('shows a failed edit on its own card with the first line of the error', () => {
    const ok = edit('/w/app/a.ts', 'x', 'y');
    const bad = edit('/w/app/a.ts', 'x', 'y');
    const items = buildTranscript([ok, result(ok.id), bad, result(bad.id, 'String not found\nmore', true)]);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ kind: 'file', error: 'String not found', count: { add: 0, del: 0 } });
  });

  it('turns sub-agent calls into agent rows, hides the status tool and skips empty replies', () => {
    const task = tool('Task', { description: 'Health check', subagent_type: 'Explore' });
    const items = buildTranscript([tool('mcp__agentview__set_status', { text: 'x' }), task, say('  '), result(task.id, 'report')]);
    expect(items.map((i) => i.kind)).toEqual(['agent']);
    expect(items[0]).toMatchObject({ kind: 'agent', result: { text: 'report' } });
  });
});

describe('sumEdits and replyLine', () => {
  it('sums successful edits across the chat and skips failed ones', () => {
    const bad = edit('/w/app/c.ts', 'a\nb\nc', '');
    const events = [edit('/w/app/a.ts', 'x', 'y\nz'), tool('Write', { file_path: '/w/app/b.ts', content: 'one\ntwo' }), bad, result(bad.id, 'nope', true)];
    expect(sumEdits(events)).toEqual({ add: 4, del: 1 });
    expect(sumEdits([user('go'), tool('Read', {})])).toBeUndefined();
  });

  it('takes the first line of the last reply without markdown markers, trimmed to 60 chars', () => {
    expect(replyLine([say('## Done\n\nAll good'), user('x'), say('')])).toBe('Done');
    expect(replyLine([say('**Bold** start')])).toBe('Bold start');
    expect(replyLine([say('a'.repeat(80))])).toHaveLength(60);
    expect(replyLine([user('x')])).toBeUndefined();
  });
});

describe('chatLine', () => {
  const live = (extra: Partial<LiveChat>): LiveChat => ({ id: 'a', sessionId: 'a', cwd: cwd, title: 'a', running: false, pending: 0, status: 'Idle', lastActive: 1, ...extra });

  it('shows the current step while running and the last reply with edits when done', () => {
    expect(chatLine(live({ running: true, status: 'Running tests', edits: { add: 1, del: 0 } }), null)).toEqual({ text: 'Running tests', edits: undefined, done: false });
    expect(chatLine(live({ last: 'All done', edits: { add: 5, del: 2 } }), null)).toEqual({ text: 'All done', edits: { add: 5, del: 2 }, done: true });
    expect(chatLine(live({ pending: 1, last: 'x' }), null)).toMatchObject({ text: 'Needs you', done: false });
    expect(chatLine(live({ last: 'Just talk' }), null)).toEqual({ text: 'Just talk', edits: undefined, done: false });
  });

  it('falls back to the chat events when the server sends no summary', () => {
    const events = [user('go'), edit('/w/app/a.ts', 'x', 'y\nz'), say('Changed a.ts')];
    expect(chatLine(live({}), events)).toEqual({ text: 'Changed a.ts', edits: { add: 2, del: 1 }, done: true });
    expect(chatLine(live({}), null)).toEqual({ text: '', edits: undefined, done: false });
  });
});

describe('stepTone', () => {
  it('groups tools by what they do', () => {
    expect(['Read', 'Grep', 'Edit', 'Bash', 'WebFetch', 'mcp__grafana_prod__query_loki_logs', 'TodoWrite'].map(stepTone)).toEqual(['read', 'read', 'edit', 'run', 'web', 'mcp', 'other']);
  });
});

describe('subagent steps', () => {
  it('nests steps under the agent that ran them and keeps them out of the main list', () => {
    const agent = tool('Agent', { description: 'Survey docs', subagent_type: 'Explore' });
    const read: ChatEvent = { ...tool('Read', { file_path: '/w/app/a.md' }), parent: agent.id } as ChatEvent;
    const done: ChatEvent = { ...result(read.id), parent: agent.id } as ChatEvent;
    const items = buildTranscript([user('go'), agent, read, done, result(agent.id, 'report')]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'agent']);
    const row = items[1] as Extract<typeof items[number], { kind: 'agent' }>;
    expect(row.result?.text).toBe('report');
    expect(row.steps).toMatchObject([{ kind: 'step', use: { name: 'Read' }, result: { text: 'ok' } }]);
  });
});

describe('agent progress', () => {
  it('takes the latest summary of the agent event for its item', () => {
    const agent = tool('Agent', { description: 'Survey docs' });
    const info = (progress: string | null): ChatEvent => ({ id: `${agent.id}:agent`, kind: 'agent', toolUseId: agent.id, description: '', subagentType: 'Explore', model: null, background: false, prompt: '', status: 'running', startedAt: 1, endedAt: null, progress, usage: null, at: at() });
    const build = createTranscriptBuilder();
    expect(build([agent])[0]).toMatchObject({ kind: 'agent', progress: null });
    expect(build([agent, info('Reading the docs')])[0]).toMatchObject({ progress: 'Reading the docs' });
    expect(build([agent, info('Writing the summary')])[0]).toMatchObject({ progress: 'Writing the summary' });
  });
});

describe('createTranscriptBuilder', () => {
  it('matches a full rebuild while a chat streams, and reuses untouched items on the fast path', () => {
    const build = createTranscriptBuilder();
    const u = user('go');
    const read = tool('Read', { file_path: '/w/a.ts' });
    const res = result(read.id);
    const a1 = say('one');
    const a2 = { ...say('two'), streaming: true };
    const a2b = { ...a2, text: 'two and more' } as ChatEvent;
    const blank = { ...a2, text: ' ' } as ChatEvent;
    const u2 = user('next');
    const other = [user('elsewhere'), say('x')];
    const steps: ChatEvent[][] = [
      [u], [u, read], [u, read, res], [u, read, res, a1], [u, read, res, a1, a2], [u, read, res, a1, a2b],
      [u, read, res, a1, a2b, u2], [u, read, res, a1, a2b, u2, say('three')], [u, read, res, a1, blank],
      [u, read, res, a1, a2b], [u, read, res, a1, a2b], [u, read, res, a1], [...other], [u, ...other],
    ];
    for (const events of steps) expect(build(events)).toEqual(buildTranscript(events));
    const base = [u, read, res, a1, a2];
    const before = build(base);
    const after = build([...base.slice(0, -1), a2b]);
    expect(after).toEqual(buildTranscript([...base.slice(0, -1), a2b]));
    after.slice(0, -1).forEach((it, i) => expect(it).toBe(before[i]));
    expect(after.at(-1)).not.toBe(before.at(-1));
  });

  it('rebuilds when the tail has a tool result or earlier events change', () => {
    const build = createTranscriptBuilder();
    const read = tool('Read', { file_path: '/w/a.ts' });
    const a = say('hi');
    const first = [user('go'), read, a];
    build(first);
    const withResult = [...first, result(read.id)];
    expect(build(withResult)).toEqual(buildTranscript(withResult));
    const paged = [user('older'), ...withResult];
    expect(build(paged)).toEqual(buildTranscript(paged));
    const swapped = [...paged.slice(0, 2), say('changed'), ...paged.slice(3)];
    expect(build(swapped)).toEqual(buildTranscript(swapped));
    expect(build([])).toEqual([]);
  });
});

describe('exploreRuns', () => {
  it('folds runs of 3 or more finished reads and searches', () => {
    const steps = [tool('Read', { file_path: '/w/a.ts' }), tool('Grep', { pattern: 'x' }), tool('Read', { file_path: '/w/c.ts' })];
    const bash = tool('Bash', { command: 'ls' });
    const pair = [tool('Read', { file_path: '/w/e.ts' }), tool('Glob', { pattern: '*' })];
    const open = tool('Read', { file_path: '/w/g.ts' });
    const items = buildTranscript([...steps.flatMap((s) => [s, result(s.id)]), bash, result(bash.id), ...pair.flatMap((s) => [s, result(s.id)]), open]);
    const runs = exploreRuns(items);
    expect([...runs.keys()]).toEqual([steps[0].id]);
    expect(runs.get(steps[0].id)!.map((s) => s.id)).toEqual(steps.map((s) => s.id));
    expect(exploreLabel(runs.get(steps[0].id)!)).toBe('2 files, 1 search');
  });
});

describe('newMarker', () => {
  const items = [{ id: 'u', kind: 'user' }, { id: 'a', kind: 'assistant' }, { id: 'b', kind: 'assistant' }] as never[];
  const ats = new Map([['u', 5], ['a', 10], ['b', 20]]);
  it('marks the first reply after the last visit and before opening', () => {
    expect(newMarker(items, ats, 12, 30)).toBe('b');
    expect(newMarker(items, ats, 1, 30)).toBe('a');
  });
  it('has no line for a never-seen chat or nothing new', () => {
    expect(newMarker(items, ats, 0, 30)).toBeNull();
    expect(newMarker(items, ats, 25, 30)).toBeNull();
  });
});

describe('newReplies', () => {
  const items = [{ id: 'u', kind: 'user' }, { id: 'a', kind: 'assistant' }, { id: 's', kind: 'step' }, { id: 'b', kind: 'assistant' }, { id: 'c', kind: 'assistant', streaming: true }] as never[];
  it('counts finished replies after the last row seen', () => {
    expect(newReplies(items, 'u')).toBe(2);
    expect(newReplies(items, 'a')).toBe(1);
    expect(newReplies(items, 'b')).toBe(0);
  });
  it('counts none for an unknown row', () => expect(newReplies(items, 'gone')).toBe(0));
});

describe('dayDividers', () => {
  const now = new Date(2026, 10, 9, 12).getTime();
  const user = (id: string, at: number) => ({ id, kind: 'user', text: '', at }) as never;
  it('labels each prompt that starts a new day', () => {
    const d = dayDividers([user('a', new Date(2026, 10, 3, 9).getTime()), user('b', new Date(2026, 10, 8, 9).getTime()), user('c', new Date(2026, 10, 8, 10).getTime()), user('d', now)], now);
    expect([...d]).toEqual([['a', 'Tuesday 3 November'], ['b', 'Yesterday'], ['d', 'Today']]);
  });
  it('has none for a chat within today', () => expect(dayDividers([user('a', now)], now).size).toBe(0));
});

describe('specCards', () => {
  type Case = { name: string; items: { id: string; kind: 'user' | 'file' | 'agent'; path?: string; subagentType?: string; prompt?: string }[]; expected: string[] };
  const cases = JSON.parse(readFileSync(path.join(__dirname, '../../../../shared/fixtures/spec-cards.json'), 'utf8')) as Case[];
  for (const c of cases) {
    it(c.name, () => {
      const items = c.items.map((i) => i.kind === 'agent' ? { kind: 'agent', id: i.id, use: { id: i.id, kind: 'tool_use', name: 'Agent', input: { subagent_type: i.subagentType, prompt: i.prompt }, summary: '', at: 0 }, running: false, progress: null, steps: [] } : i.kind === 'file' ? { kind: 'file', id: i.id, path: i.path, count: { add: 0, del: 0 }, uses: [] } : { kind: 'user', id: i.id, text: '', at: 0 }) as Item[];
      expect([...specCards(items)]).toEqual(c.expected);
    });
  }
});

describe('collapsible boxes', () => {
  it('draw one header button with aria-expanded for an Explored group', () => {
    const explored = renderToStaticMarkup(createElement(Explored, { id: 's1', run: [], cwd }));
    expect(explored.match(/<button/g)).toHaveLength(1);
    expect(explored).toContain('aria-expanded="false"');
  });
});

