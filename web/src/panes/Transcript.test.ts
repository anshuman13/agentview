import { describe, expect, it } from 'vitest';
import { buildTranscript, duration, stepLabel, stepTone } from './steps';
import { editCount, replyLine, sumEdits } from '../../../shared/edits';
import { chatLine } from './Sessions';
import type { ChatEvent, LiveChat } from '../../../shared/protocol';

let n = 0;
const at = () => ++n;
const tool = (name: string, input: Record<string, unknown>): ChatEvent => ({ id: `t${at()}`, kind: 'tool_use', name, input, summary: name, at: n });
const result = (toolUseId: string, text = 'ok', isError = false): ChatEvent => ({ id: `r${at()}`, kind: 'tool_result', toolUseId, text, isError, at: n });
const say = (text: string): ChatEvent => ({ id: `a${at()}`, kind: 'assistant', text, streaming: false, at: n });
const user = (text: string): ChatEvent => ({ id: `u${at()}`, kind: 'user', text, at: n });
const edit = (file: string, oldText: string, newText: string) => tool('Edit', { file_path: file, old_string: oldText, new_string: newText });
const cwd = '/w/app';

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

describe('editCount', () => {
  it('counts the lines of old and new text, or of the written content', () => {
    expect(editCount('Edit', { old_string: 'a\nb', new_string: 'c' })).toEqual({ add: 1, del: 2 });
    expect(editCount('Write', { content: 'a\nb\nc' })).toEqual({ add: 3, del: 0 });
    expect(editCount('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b\nc' }, { old_string: '', new_string: 'd' }] })).toEqual({ add: 3, del: 1 });
    expect(editCount('Read', { file_path: 'x' })).toBeNull();
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
