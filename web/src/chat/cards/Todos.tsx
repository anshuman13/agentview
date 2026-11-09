import { useEffect, useState } from 'react';
import { api } from '../../app/store';
import { QuickPick } from '../../ui/QuickPick';

export type Todo = { path: string; line: number; text?: string; ai?: string | null };

// The same prompts as android TodosUi.kt todoPrompt.
function todoPrompt(t: Todo) {
  const at = `${t.path}:${t.line}`;
  if (t.ai === '!') return `Do what the AI! comment at ${at} asks ("${t.text}"). Read the code around it and any other AI comments in the repo, make the change, remove the comment and tell me what you did.`;
  if (t.ai === '?') return `Answer the AI? comment at ${at} ("${t.text}"). Read the code around it and change nothing.`;
  return `Resolve the TODO at ${at}${t.text ? ` ("${t.text}")` : ''}. Read the code around it, make the change, remove the comment and tell me what you did.`;
}

const todoTitle = (t: Todo) => `${t.ai ? `AI${t.ai} ` : ''}${t.text || 'TODO'}`;

// Aider-style AI comments, to-do and fix-me comments in the repo as ready-made tasks; a pick puts a prompt for one in the composer.
export function TodosPick({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  useEffect(() => {
    fetch(api('/api/git/todos')).then((r) => r.json()).then((r: { todos?: Todo[] }) => setTodos(Array.isArray(r?.todos) ? r.todos : [])).catch(() => setTodos([]));
  }, []);
  const items = todos === null ? [{ value: '', label: 'Looking for TODOs…' }] : todos.length ? todos.map((t, i) => ({ value: String(i), label: todoTitle(t), detail: `${t.path}:${t.line}` })) : [{ value: '', label: 'No TODO, FIXME or AI! comments in tracked files' }];
  return (
    <QuickPick
      anchor={anchor}
      title="TODOs"
      items={items}
      onPick={(v) => {
        const t = v ? todos?.[Number(v)] : undefined;
        if (t) window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: todoPrompt(t) } }));
        onClose();
      }}
      onClose={onClose}
    />
  );
}
