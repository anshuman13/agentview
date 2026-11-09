import type { ChatEvent } from './protocol.js';

export type TodoItem = { content: string; activeForm: string; status: 'pending' | 'in_progress' | 'completed' };

const STATUSES = new Set(['pending', 'in_progress', 'completed']);

// The list from the newest TodoWrite call of the chat itself (not a sub-agent's); null when Claude has not written one.
export function latestTodos(events: ChatEvent[]): TodoItem[] | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'tool_use' || e.name !== 'TodoWrite' || e.parent) continue;
    const list = Array.isArray(e.input.todos) ? e.input.todos : [];
    return list
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof t.content === 'string' && STATUSES.has(String(t.status)))
      .map((t) => ({ content: String(t.content), activeForm: typeof t.activeForm === 'string' ? t.activeForm : '', status: t.status as TodoItem['status'] }));
  }
  return null;
}

export const todoCount = (todos: TodoItem[]) => ({ done: todos.filter((t) => t.status === 'completed').length, total: todos.length });

export const todoProgress = ({ done, total }: { done: number; total: number }) => `${done} of ${total}`;

// What Claude is on: the in-progress item, else the first one still to do.
export function todoCurrent(todos: TodoItem[]): string {
  const t = todos.find((x) => x.status === 'in_progress') ?? todos.find((x) => x.status === 'pending');
  return t ? t.activeForm || t.content : '';
}
