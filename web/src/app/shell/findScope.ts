import type { List } from '../../codex/view';

export type FindFocus = 'modal' | 'terminal' | 'editor' | 'codex' | 'sidebar' | 'chat' | 'none';
export type FindScope = 'chat' | 'tasks' | 'wiki' | 'search' | null;

// Sheets, dialogs and the command palette are role="dialog" or "alertdialog"; the file pane is every `.editor` but Codex's.
export function focusOf(el: Element | null): FindFocus {
  if (!el || el === document.body) return 'none';
  if (el.closest('[role="dialog"], [role="alertdialog"]')) return 'modal';
  if (el.closest('.xterm')) return 'terminal';
  if (el.closest('.cm-editor, .editor:not(.as-editor)')) return 'editor';
  if (el.closest('.assistant')) return 'codex';
  if (el.closest('.sidebar')) return 'sidebar';
  if (el.closest('.brief')) return 'chat';
  return 'none';
}

// Where ⌘F searches. `list` is the Codex list, null while a page is open over it.
export function findScope({ focus, chatShown, codexShown, list }: { focus: FindFocus; chatShown: boolean; codexShown: boolean; list: List | null }): FindScope {
  if (focus === 'modal' || focus === 'terminal' || focus === 'editor') return null;
  if (focus === 'codex' || (codexShown && !chatShown)) return list === 'tasks' ? 'tasks' : list === 'wiki' ? 'wiki' : 'search';
  return chatShown ? 'chat' : null;
}
