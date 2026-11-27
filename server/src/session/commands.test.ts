import { describe, expect, it } from 'bun:test';
import { SESSION_COMMANDS, parseSubtask, withSessionCommands } from './commands.js';

describe('withSessionCommands', () => {
  it('adds the session commands after the provider ones, keeping the provider wording', () => {
    const list = withSessionCommands([{ name: 'compact', description: 'CLI compact' }, { name: 'clear', description: 'Clear' }]);
    expect(list.slice(0, 2)).toEqual([{ name: 'compact', description: 'CLI compact' }, { name: 'clear', description: 'Clear' }]);
    expect(list.filter((c) => c.name === 'compact')).toHaveLength(1);
    expect(list.map((c) => c.name)).toEqual(expect.arrayContaining(SESSION_COMMANDS.map((c) => c.name)));
  });
});

describe('/subtask', () => {
  it('is hidden where the chat cannot fork', () => {
    expect(withSessionCommands([], false).some((c) => c.name === 'subtask')).toBe(false);
    expect(withSessionCommands([], true).some((c) => c.name === 'subtask')).toBe(true);
  });

  it('parses the task', () => {
    expect(parseSubtask('/subtask fix the  tests\nnow')).toBe('fix the  tests\nnow');
    expect(parseSubtask(' /subtask ')).toBe('');
    expect(parseSubtask('/subtasks x')).toBeNull();
    expect(parseSubtask('do /subtask x')).toBeNull();
  });
});
