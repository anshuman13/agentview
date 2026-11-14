import { describe, expect, it } from 'bun:test';
import { catchUp, recap, recapText } from './recap';
import type { ChatEvent, Round } from '../../../../shared/protocol';

let n = 0;
const at = () => ++n;
const user = (text: string): ChatEvent => ({ id: `u${at()}`, kind: 'user', text, at: n });
const tool = (name: string, input: Record<string, unknown>): ChatEvent => ({ id: `t${at()}`, kind: 'tool_use', name, input, summary: name, at: n });
const result = (use: ChatEvent, isError = false): ChatEvent => ({ id: `r${at()}`, kind: 'tool_result', toolUseId: use.id, text: isError ? 'Exit code 1\nboom' : 'ok', isError, at: n });

describe('recap', () => {
  const e1 = tool('Edit', { file_path: '/w/a.ts', old_string: 'x', new_string: 'y' });
  const e2 = tool('Write', { file_path: '/w/b.ts', content: 'z' });
  const e3 = tool('Edit', { file_path: '/w/a.ts', old_string: 'y', new_string: 'q' });
  const bad = tool('Bash', { command: 'npm test' });
  const ok = tool('Bash', { command: 'ls' });
  const events = [user('one'), e1, result(e1), user('two'), e2, result(e2), bad, result(bad, true), user('three'), e3, result(e3), ok, result(ok)];

  it('counts turns, distinct files and failed commands after the seen id', () => {
    expect(recap(events, 'r7', false)).toEqual({ turns: 2, files: 2, failed: 1, pending: false });
    expect(recap(events, 'u11', true)).toEqual({ turns: 0, files: 1, failed: 0, pending: true });
  });

  it('shows nothing without a seen id, when the id is gone or nothing followed it', () => {
    expect(recap(events, null, false)).toBeNull();
    expect(recap(events, 'nope', false)).toBeNull();
    expect(recap(events, 'r13', false)).toBeNull();
    expect(recap([user('x'), tool('Read', { file_path: '/w/a.ts' })], 'u14', false)).toBeNull();
  });

  it('writes one line with only the parts that are not zero', () => {
    expect(recapText({ turns: 2, files: 1, failed: 0, pending: true })).toBe('Since you last looked: 2 turns, 1 file, pending');
    expect(recapText({ turns: 0, files: 0, failed: 3, pending: false })).toBe('Since you last looked: 3 failed commands');
  });
});

describe('catchUp', () => {
  const seen: ChatEvent = { id: 'seen', kind: 'system', text: '', at: 100 };
  const round = (n: number, at: number, outcome: Round['outcome'], line = ''): Round => ({ n, at, outcome, line, costUsd: 0 });

  it('counts the rounds after the seen event and quotes the last one that is not quiet', () => {
    const rounds = [round(1, 90, 'blocked', 'old'), round(2, 110, 'quiet'), round(3, 120, 'blocked', 'needs a token'), round(4, 130, 'quiet'), round(5, 140, 'quiet')];
    expect(catchUp([seen], 'seen', rounds)).toBe('While you were away: 4 rounds, 3 quiet, 1 blocked: needs a token');
  });

  it('shows nothing without new rounds or a known seen event', () => {
    expect(catchUp([seen], 'seen', [round(1, 90, 'done')])).toBeNull();
    expect(catchUp([seen], 'gone', [round(1, 190, 'done')])).toBeNull();
    expect(catchUp([seen], null, [round(1, 190, 'done')])).toBeNull();
  });
});
