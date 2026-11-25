import { describe, expect, it } from 'bun:test';
import { commitIn } from './savedChat.js';

const call = (id: string, command: string) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
const result = (id: string, content: unknown) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });

describe('commitIn', () => {
  it('reads the first commit from a git commit step', () => {
    expect(commitIn([
      call('ls', 'git log --oneline -1'),
      result('ls', 'abc1234 Not a commit step'),
      call('c1', 'git add x && git commit -m "Add the store"'),
      result('c1', [{ type: 'text', text: 'hooks passed\n[anshuman/x (root-commit) 1a2b3c4d5e] Add the store\n 2 files changed' }]),
      call('c2', 'git commit -m later'),
      result('c2', '[main 9999999] Later commit'),
    ])).toEqual({ hash: '1a2b3c4', subject: 'Add the store' });
  });

  it('reads the git log line after a quiet commit, and nothing without a commit', () => {
    expect(commitIn([call('c', 'git add x && git commit -qm "Add it" && git log --oneline -1'), result('c', 'e28b0d25 Archive and restore whole sub-chat groups')])).toEqual({ hash: 'e28b0d2', subject: 'Archive and restore whole sub-chat groups' });
    expect(commitIn([call('c', 'git status'), result('c', 'e28b0d25 nothing')])).toBeNull();
  });
});
