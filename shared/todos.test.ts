import { describe, expect, it } from 'vitest';
import type { ChatEvent } from './protocol';
import { latestTodos, todoCount, todoCurrent, todoProgress } from './todos';

const write = (id: string, todos: unknown, parent?: string): ChatEvent => ({ id, kind: 'tool_use', name: 'TodoWrite', input: { todos }, summary: '', at: 1, ...(parent && { parent }) });
const item = (content: string, status: string, activeForm = '') => ({ content, status, activeForm });

describe('todos', () => {
  const list = [item('Read code', 'completed'), item('Write test', 'in_progress', 'Writing the test'), item('Ship', 'pending')];

  it('reads the newest list of the chat and ignores sub-agents', () => {
    const events = [write('a', [item('Old', 'pending')]), write('b', list), write('c', [item('Agent', 'pending')], 'agent1')];
    expect(latestTodos(events)?.map((t) => t.content)).toEqual(['Read code', 'Write test', 'Ship']);
    expect(latestTodos([])).toBeNull();
  });

  it('counts progress and names the current item', () => {
    const todos = latestTodos([write('a', list)])!;
    expect(todoProgress(todoCount(todos))).toBe('1 of 3');
    expect(todoCurrent(todos)).toBe('Writing the test');
    expect(todoCurrent(todos.map((t) => ({ ...t, status: 'completed' as const })))).toBe('');
  });
});
