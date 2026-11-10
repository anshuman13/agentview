import { describe, expect, it } from 'vitest';
import { stampedNotes } from '../../codex/data/meetings/meetings';
import type { Meeting } from '../../codex/data/wiki/wiki';
import { accept, addUse, chatMarkdown, chatQuery, currentMeeting, buildHistory, filesEdited, ghostFor, rankChats, rankCommands, rankFiles, nextMode, remember, replyNote, sharedTask, triggerAt, turnEnd, withUses, draftLine, quoteReply, runLine, goalText, loopNow, agentAge } from './composerLogic';
import { WORKSPACE } from '../../../../shared/workspace';
import type { ChatEvent, ChatRun, SavedSession } from '../../../../shared/protocol';

let n = 0;
const user = (text: string): ChatEvent => ({ id: `u${++n}`, kind: 'user', text, at: n });
const tool = (name: string, input: Record<string, unknown>): ChatEvent => ({ id: `t${++n}`, kind: 'tool_use', name, input, summary: name, at: n });

describe('triggerAt', () => {
  it('finds a slash command at the start of a word', () => {
    expect(triggerAt('/', 1)).toEqual({ kind: 'command', start: 0, query: '' });
    expect(triggerAt('/comp', 5)).toEqual({ kind: 'command', start: 0, query: 'comp' });
    expect(triggerAt('run /co', 7)).toEqual({ kind: 'command', start: 4, query: 'co' });
  });

  it('finds a file mention and keeps the slashes in the query', () => {
    expect(triggerAt('fix @src/store.ts', 17)).toEqual({ kind: 'file', start: 4, query: 'src/store.ts' });
  });

  it('looks at the word under the caret only', () => {
    expect(triggerAt('/compact now', 12)).toBeNull();
    expect(triggerAt('/compact now', 5)).toEqual({ kind: 'command', start: 0, query: 'comp' });
    expect(triggerAt('a/b', 3)).toBeNull();
    expect(triggerAt('mail@me', 7)).toBeNull();
  });

  it('treats a leading bang as shell mode', () => {
    expect(triggerAt('!ls -la', 7)).toEqual({ kind: 'shell' });
    expect(triggerAt('say hi!', 7)).toBeNull();
  });
});

describe('rankCommands', () => {
  const cmds = [{ name: 'add-dir' }, { name: 'compact' }, { name: 'config' }, { name: 'cost' }, { name: 'doctor' }];
  it('puts prefix matches first and marks the matched characters', () => {
    const r = rankCommands(cmds, 'co');
    expect(r.slice(0, 3).map((x) => x.item.name).sort()).toEqual(['compact', 'config', 'cost']);
    expect(r[3]).toMatchObject({ item: { name: 'doctor' }, hits: [2, 4] });
    expect(r[0].hits).toEqual([0, 1]);
  });

  it('shows everything for an empty query, capped at the row limit', () => {
    expect(rankCommands(cmds, '')).toHaveLength(5);
    expect(rankCommands(cmds, '', 2)).toHaveLength(2);
  });

});

describe('rankFiles', () => {
  it('favours the file name over the folder', () => {
    const r = rankFiles(['web/src/store.ts', 'store/web.ts', 'docs/notes.md'], 'web');
    expect(r.map((x) => x.item)).toEqual(['store/web.ts', 'web/src/store.ts']);
  });
});

describe('accept', () => {
  it('replaces the token under the caret and adds a space', () => {
    expect(accept('/comp', 0, 5, '/compact')).toEqual({ text: '/compact ', caret: 9 });
    expect(accept('fix @sto please', 4, 8, '@src/store.ts')).toEqual({ text: 'fix @src/store.ts  please', caret: 18 });
  });
});

describe('buildHistory', () => {
  it('lists this chat newest first, then stored prompts, without repeats or blanks', () => {
    const h = buildHistory([user('first'), user('  '), user('second')], ['old', 'first', 'other']);
    expect(h).toEqual(['second', 'first', 'other', 'old']);
  });
});

describe('ghostFor', () => {
  const history = ['run the tests', 'run the linter', 'ru'];
  it('completes from the most recent matching prompt once three characters are typed', () => {
    expect(ghostFor('run', history)).toBe(' the tests');
    expect(ghostFor('run the l', history)).toBe('inter');
  });

  it('stays quiet for short or complete text', () => {
    expect(ghostFor('ru', history)).toBe('');
    expect(ghostFor('run the tests', history)).toBe('');
    expect(ghostFor('nothing', history)).toBe('');
  });
});

describe('remember', () => {
  it('moves a repeated prompt to the end and keeps the last 50', () => {
    expect(remember('a', ['a', 'b'])).toEqual(['b', 'a']);
    const many = Array.from({ length: 50 }, (_, i) => `p${i}`);
    const r = remember('new', many);
    expect(r).toHaveLength(50);
    expect(r[0]).toBe('p1');
    expect(r.at(-1)).toBe('new');
  });
});

describe('filesEdited', () => {
  it('counts distinct paths across the edit tools only', () => {
    const events = [
      tool('Edit', { file_path: '/a.ts' }),
      tool('Write', { file_path: '/b.ts' }),
      tool('MultiEdit', { file_path: '/a.ts' }),
      tool('Read', { file_path: '/c.ts' }),
      tool('Edit', {}),
      user('ok'),
    ];
    expect(filesEdited(events)).toBe(2);
    expect(filesEdited([])).toBe(0);
  });
});

describe('turnEnd', () => {
  const say = (text: string, parent?: string): ChatEvent => ({ id: `a${++n}`, kind: 'assistant', text, streaming: false, at: n, parent });
  it('reads the last top-level reply of the current turn only', () => {
    expect(turnEnd([user('a'), say('old'), user('b'), say('new'), say('sub', 't1')], 'Codex')).toBe('Codex: new');
    expect(turnEnd([user('a'), say('old'), user('b')], 'Codex')).toBe('Codex finished');
  });
});

describe('addUse', () => {
  it('keeps one entry per server, narrowing to tools or widening back', () => {
    const docs = { server: 'claude.ai Claude Docs' };
    const read = { server: 'claude.ai Claude Docs', tool: 'read' };
    const query = { server: 'claude.ai Claude Docs', tool: 'query' };
    expect(addUse([], docs)).toEqual([docs]);
    expect(addUse([docs], docs)).toEqual([docs]);
    expect(addUse([docs], read)).toEqual([read]);
    expect(addUse([read], query)).toEqual([read, query]);
    expect(addUse([read, query], read)).toEqual([query, read]);
    expect(addUse([read, query], docs)).toEqual([docs]);
    expect(addUse([read], { server: 'chrome' })).toEqual([read, { server: 'chrome' }]);
  });
});

describe('withUses', () => {
  it('appends one line naming the servers and tools, except on slash commands', () => {
    expect(withUses('summarise it', [])).toBe('summarise it');
    expect(withUses('summarise it', [{ server: 'claude.ai Claude Docs' }])).toBe('summarise it\n\nUse the claude.ai Claude Docs MCP server for this.');
    expect(withUses('go', [{ server: 'claude.ai Claude Docs', tool: 'read' }, { server: 'chrome' }, { server: 'chrome', tool: 'navigate' }])).toBe(
      'go\n\nUse the mcp__claude_ai_Claude_Docs__read tool, the chrome MCP server and the mcp__chrome__navigate tool for this.',
    );
    expect(withUses('/compact', [{ server: 'chrome' }])).toBe('/compact');
  });
});

describe('sharedTask', () => {
  it('keeps the link in the title and reads a time', () => {
    const now = new Date(2026, 9, 30, 8, 0);
    expect(sharedTask(' Read https://example.com/a?b=1 ', now)).toEqual({ title: 'Read https://example.com/a?b=1', at: null });
    const r = sharedTask('Call back tomorrow at 3pm https://example.com', now);
    expect(r.at).toBe(new Date(2026, 9, 31, 15, 0).getTime());
    expect(r.title).toBe('Call back https://example.com');
  });
});

describe('currentMeeting', () => {
  const now = new Date(2026, 0, 5, 10, 0).getTime();
  const min = 60_000;
  const m = (id: string, start: number, end: number | null): Meeting => ({ id, profile: 'work', title: id, starts_at: start, ends_at: end } as Meeting);
  it('picks a running meeting, or one within 15 minutes', () => {
    expect(currentMeeting([m('a', now - 10 * min, now + 20 * min)], now)?.id).toBe('a');
    expect(currentMeeting([m('a', now + 10 * min, now + 40 * min)], now)?.id).toBe('a');
  });
  it('ignores far, ended, block and all-day meetings', () => {
    expect(currentMeeting([m('a', now + 15 * min, now + 40 * min), m('b', now - 40 * min, now - 10 * min), m('block:c', now - min, now + min), m('d', now - min, null)], now)).toBeNull();
  });
  it('prefers the latest running start, then the soonest upcoming', () => {
    expect(currentMeeting([m('a', now - 30 * min, now + 30 * min), m('b', now - 5 * min, now + 30 * min), m('c', now + 5 * min, now + 30 * min)], now)?.id).toBe('b');
    expect(currentMeeting([m('a', now + 12 * min, now + 30 * min), m('b', now + 5 * min, now + 30 * min)], now)?.id).toBe('b');
  });
});

describe('stampedNotes', () => {
  const at = new Date(2026, 0, 5, 9, 5).getTime();
  it('stamps the first line only and appends after existing notes', () => {
    expect(stampedNotes(null, ' hi ', at)).toBe('09:05 hi');
    expect(stampedNotes('old\n', 'a\nb', at)).toBe('old\n09:05 a\nb');
  });
  it('ignores blank text', () => {
    expect(stampedNotes('old', '  \n', at)).toBeNull();
  });
});

describe('nextMode', () => {
  it('cycles the modes a provider offers', () => {
    const modes = [{ value: 'default' }, { value: 'auto' }, { value: 'readOnly' }];
    expect(nextMode(modes, 'default')).toBe('auto');
    expect(nextMode(modes, 'readOnly')).toBe('default');
    expect(nextMode(modes, 'plan')).toBe('default');
  });
});

describe('chat mentions', () => {
  it('lists chats by title after @chat:', () => {
    expect(chatQuery(triggerAt('see @chat:tri', 13))).toBe('tri');
    expect(chatQuery(triggerAt('see @src', 8))).toBeNull();
    const chats = [{ sessionId: 'a', title: '/tries worktrees', cwd: '/r' }, { sessionId: 'b', title: 'Day dividers', cwd: '/r' }, { sessionId: 'c', title: '', cwd: '/r' }] as SavedSession[];
    expect(rankChats(chats, 'tri').map((r) => r.item.sessionId)).toEqual(['a']);
  });
});

describe('chatMarkdown', () => {
  it('lists prompts and top-level replies under the title', () => {
    const events = [
      { id: '1', kind: 'user', text: 'Fix it ', at: 1 },
      { id: '2', kind: 'assistant', text: 'Subagent note', streaming: false, at: 2, parent: 'x' },
      { id: '3', kind: 'assistant', text: 'Fixed.', streaming: false, at: 3 },
      { id: '4', kind: 'user', text: 'queued', at: 4, queued: true },
    ] as ChatEvent[];
    expect(chatMarkdown(events, 'Importer')).toBe('# Importer\n\n**You:** Fix it\n\nFixed.\n');
  });
});

describe('replyNote', () => {
  it('puts the chat title first and picks the profile from the folder', () => {
    WORKSPACE.personalRoot = '/Users/me/workspace_personal';
    expect(replyNote(' Fixed. ', 'Importer', '/Users/me/workspace_personal/app')).toEqual({ text: 'Importer\nFixed.', profile: 'personal' });
    expect(replyNote('Fixed.', '', '/Users/me/workspace/app')).toEqual({ text: 'Saved reply\nFixed.', profile: 'work' });
  });
});

describe('draftLine', () => {
  it('takes the first non-empty line, trimmed', () => {
    expect(draftLine('\n  fix the login \nand more')).toBe('fix the login');
    expect(draftLine('  \n ')).toBe('');
  });
});

describe('quoteReply', () => {
  it('quotes each line and cuts long replies at a word', () => {
    expect(quoteReply('Done.\n\nTests pass')).toBe('> Done.\n>\n> Tests pass\n\n');
    expect(quoteReply('one two three', 9)).toBe('> one two…\n\n');
  });
});

describe('runLine', () => {
  const run = (over: Partial<ChatRun>) => ({ kind: 'loop', state: 'running', why: '', round: 4, max: 0, nextAt: null, ...over }) as ChatRun;
  it('says the state of each kind of run', () => {
    expect(runLine(run({ nextAt: new Date(2026, 10, 9, 14, 20).getTime() }))).toBe('Loop · round 4 · next 14:20');
    expect(runLine(run({}))).toBe('Loop · round 4');
    expect(runLine(run({ state: 'paused', why: 'usage limit until 18:00' }))).toBe('Paused · usage limit until 18:00');
    expect(runLine(run({ kind: 'goal', round: 3, max: 20 }))).toBe('Goal · check 3 of 20');
    expect(runLine(run({ kind: 'goal', round: 12, every: 3_600_000, nextAt: new Date(2026, 10, 9, 14, 20).getTime() }))).toBe('Standing goal · round 12 · next 14:20');
    expect(runLine(run({ kind: 'goal', round: 3, every: 3_600_000 }))).toBe('Standing goal · round 3');
    expect(runLine(run({ kind: 'cycle', round: 2, max: 3 }), 'test')).toBe('Build cycle · round 2/3 · Test');
    expect(runLine(run({ kind: 'cycle', round: 2, max: 3 }), 'passed')).toBe('Build cycle · round 2/3');
  });
});

describe('goal choice', () => {
  const now = new Date(2026, 0, 5, 14, 30).getTime();

  it('wraps the next message as a goal or loop', () => {
    expect(goalText('done', 'ship it', now)).toBe('/goal ship it');
    expect(goalText('morning', 'ship it', now)).toBe('/loop until 07:00 ship it');
    expect(goalText('1h', 'ship it', now)).toBe('/loop until 15:30 ship it');
    expect(goalText('4h', 'ship it', now)).toBe('/loop until 18:30 ship it');
    expect(goalText('hourly', 'ship it', now)).toBe('/goal every 1h ship it');
    expect(goalText('off', 'hi', now)).toBe('hi');
    expect(goalText('1h', '/compact', now)).toBe('/compact');
  });

});

describe('loopNow', () => {
  const run = (rounds: { at: number; line: string }[], startedAt = 100) => ({ startedAt, nextAt: null, rounds: rounds.map((r) => ({ n: 1, outcome: 'progress', costUsd: 0, ...r })) }) as unknown as ChatRun;
  it('takes the newer of the status and the last round, and ignores a status from before the run', () => {
    expect(loopNow(run([{ at: 200, line: 'round' }]), { text: 'Working', at: 300, next: ['a', 'b'] })).toMatchObject({ source: 'status', title: 'Working', next: 'a', stepsLeft: 2 });
    expect(loopNow(run([{ at: 400, line: 'round' }]), { text: 'Working', at: 300 })).toMatchObject({ source: 'round', title: 'round' });
    expect(loopNow(run([]), { text: 'Old', at: 50 })).toMatchObject({ source: 'none', title: 'Waiting for the first round' });
  });
  it('words agent ages', () => {
    expect(agentAge(0, 5_000)).toBe('1 min');
    expect(agentAge(0, 12 * 60_000)).toBe('12 min');
    expect(agentAge(0, 65 * 60_000)).toBe('1 h 5 min');
  });
});
