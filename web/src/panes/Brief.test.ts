import { describe, expect, it } from 'vitest';
import { buildTimeline } from './Brief';
import type { ChatEvent } from '../../../shared/protocol';

let n = 0;
const at = () => ++n;
const user = (text: string): ChatEvent => ({ id: `u${at()}`, kind: 'user', text, at: n });
const status = (input: Record<string, unknown>): ChatEvent => ({ id: `s${at()}`, kind: 'tool_use', name: 'mcp__agentview__set_status', input, summary: '', at: n });
const tool = (name: string): ChatEvent => ({ id: `t${at()}`, kind: 'tool_use', name, input: {}, summary: name, at: n });

describe('buildTimeline', () => {
  it('takes next steps from the latest status', () => {
    const b = buildTimeline([user('go'), status({ text: 'a', next: ['b', 'c'] }), status({ text: 'b', next: ['c'] })]);
    expect(b.next).toEqual(['c']);
  });

  it('clears next steps when a new prompt starts', () => {
    const b = buildTimeline([user('go'), status({ text: 'a', next: ['b'] }), user('steer')]);
    expect(b.next).toEqual([]);
  });

  it('puts prompts, finished parts and notes on the timeline in order', () => {
    const b = buildTimeline([
      user('fix it'),
      status({ text: 'a', done: 'Bearer prefix required' }),
      status({ text: 'b', important: '  ', done: ' ' }),
      status({ text: 'c', important: 'direnv blocks the env file' }),
      user('test it'),
    ]);
    expect(b.moments.map((m) => [m.kind, m.text])).toEqual([
      ['you', 'fix it'],
      ['done', 'Bearer prefix required'],
      ['note', 'direnv blocks the env file'],
      ['you', 'test it'],
    ]);
  });

  it('keeps only the latest reply for each instruction', () => {
    const say = (text: string): ChatEvent => ({ id: `a${at()}`, kind: 'assistant', text, streaming: false, at: n });
    const b = buildTimeline([user('go'), say('Starting'), status({ text: 'x', done: 'Part one' }), say('All done. Commit?'), user('yes')]);
    expect(b.moments.map((m) => [m.kind, m.text])).toEqual([
      ['you', 'go'],
      ['done', 'Part one'],
      ['reply', 'All done. Commit?'],
      ['you', 'yes'],
    ]);
  });

  it('lets a plan change from the user replace the next steps', () => {
    const plan: ChatEvent = { id: `p${at()}`, kind: 'plan', next: ['curl /check'], at: n };
    expect(buildTimeline([user('go'), status({ text: 'a', next: ['b', 'c'] }), plan]).next).toEqual(['curl /check']);
    expect(buildTimeline([user('go'), plan, status({ text: 'a', next: ['d'] })]).next).toEqual(['d']);
  });

  it('ignores the status tool when picking the last tool', () => {
    const b = buildTimeline([user('go'), tool('Bash'), status({ text: 'x' })]);
    expect(b.lastTool?.kind === 'tool_use' && b.lastTool.name).toBe('Bash');
  });

  it('counts advisor consults and turns Fable answers into notes', () => {
    const ask: ChatEvent = { id: 'f1', kind: 'tool_use', name: 'Agent', input: { subagent_type: 'big-bro' }, summary: '', at: at() };
    const answer: ChatEvent = { id: 'f2', kind: 'tool_result', toolUseId: 'f1', text: '[Subagent hand-back] The report follows:\n  Use a lock.\n  Then retry.\nagentId: a1 (use SendMessage)\n<usage>tool_uses: 1</usage>', isError: false, at: at() };
    const b = buildTimeline([user('go'), tool('Advisor'), tool('Advisor'), ask, answer]);
    expect(b.advisor).toBe(2);
    expect(b.fable).toBe(1);
    expect(b.moments.at(-1)).toMatchObject({ kind: 'fable', text: 'Use a lock.\nThen retry.' });
  });
});
