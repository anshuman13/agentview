import { describe, expect, it } from 'vitest';
import { buildBrief } from './Brief';
import type { ChatEvent } from '../../../shared/protocol';

let n = 0;
const at = () => ++n;
const user = (text: string): ChatEvent => ({ id: `u${at()}`, kind: 'user', text, at: n });
const status = (input: Record<string, unknown>): ChatEvent => ({ id: `s${at()}`, kind: 'tool_use', name: 'mcp__agentview__set_status', input, summary: '', at: n });
const tool = (name: string): ChatEvent => ({ id: `t${at()}`, kind: 'tool_use', name, input: {}, summary: name, at: n });
const result = (text: string): ChatEvent => ({ id: `r${at()}`, kind: 'result', text, costUsd: 0, isError: false, at: n });

describe('buildBrief', () => {
  it('takes next steps from the latest status', () => {
    const b = buildBrief([user('go'), status({ text: 'a', next: ['b', 'c'] }), status({ text: 'b', next: ['c'] })]);
    expect(b.next).toEqual(['c']);
  });

  it('clears next steps when a new prompt starts', () => {
    const b = buildBrief([user('go'), status({ text: 'a', next: ['b'] }), user('steer')]);
    expect(b.next).toEqual([]);
  });

  it('keeps important notes newest first and skips empty ones', () => {
    const b = buildBrief([status({ text: 'a', important: 'first' }), status({ text: 'b', important: '  ' }), status({ text: 'c', important: 'second' })]);
    expect(b.notes.map((x) => x.text)).toEqual(['second', 'first']);
  });

  it('ignores the status tool when picking the last tool', () => {
    const b = buildBrief([user('go'), tool('Bash'), status({ text: 'x' })]);
    expect(b.lastTool?.kind === 'tool_use' && b.lastTool.name).toBe('Bash');
  });

  it('counts advisor consults and turns Fable answers into notes', () => {
    const ask: ChatEvent = { id: 'f1', kind: 'tool_use', name: 'Agent', input: { subagent_type: 'big-bro' }, summary: '', at: at() };
    const answer: ChatEvent = { id: 'f2', kind: 'tool_result', toolUseId: 'f1', text: '[Subagent hand-back] The report follows:\n  Use a lock.\n  Then retry.\nagentId: a1 (use SendMessage)\n<usage>tool_uses: 1</usage>', isError: false, at: at() };
    const b = buildBrief([user('go'), tool('Advisor'), tool('Advisor'), ask, answer]);
    expect(b.advisor).toBe(2);
    expect(b.fable).toBe(1);
    expect(b.notes[0]).toMatchObject({ text: 'Use a lock.\nThen retry.', fable: true });
  });

  it('shows the last reply only when the turn has ended', () => {
    expect(buildBrief([user('go'), result('done')]).reply).toBe('done');
    expect(buildBrief([user('go'), result('done'), user('again')]).reply).toBeNull();
  });
});
