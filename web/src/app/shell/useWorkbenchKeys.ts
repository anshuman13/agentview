import { useEffect, useRef } from 'react';
import { getState, setUi } from '../store';
import { sideChat } from '../../chat/chatActions';
import { requestFind } from '../../chat/transcript/FindBar';
import { openSearch, useView, type View } from '../../codex/view';
import { command } from '../../ui/util';
import { findScope, focusOf } from './findScope';
import { MAC } from './keys';

const shown = (selector: string) => document.querySelector<HTMLElement>(selector)?.offsetParent != null;

function find(e: KeyboardEvent, view: View) {
  const at = document.activeElement;
  const focus = focusOf(at);
  const scope = findScope({ focus, chatShown: shown('.brief .tr'), codexShown: shown('.as-editor .assistant'), list: view.open || view.tag ? null : view.list });
  if (!scope) return;
  e.preventDefault();
  if (scope === 'chat') {
    const query = focus === 'sidebar' && at instanceof HTMLInputElement ? at.value.trim() : '';
    const sessionId = getState().session.sessionId;
    if (query && sessionId) requestFind({ sessionId, query, at: null }, true);
    else window.dispatchEvent(new Event('agentview:find'));
  } else if (scope === 'tasks') {
    const el = document.querySelector<HTMLElement>('.assistant [aria-label="Search tasks"]');
    if (el instanceof HTMLInputElement) el.focus();
    else el?.click();
  } else if (scope === 'wiki') document.querySelector<HTMLInputElement>('.wk-search input')?.focus();
  else openSearch(window.getSelection()?.toString().trim() ?? '');
}

type Toggles = {
  toggleChat: () => void;
  toggleSidebar: () => void;
  toggleTerminal: () => void;
  switchEditor: () => void;
};

export function useWorkbenchKeys({ toggleChat, toggleSidebar, toggleTerminal, switchEditor }: Toggles) {
  const shownView = useView();
  const view = useRef(shownView);
  view.current = shownView;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(MAC ? e.metaKey : e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'f' && !e.altKey && !e.shiftKey) find(e, view.current);
      if (k === 'p') { e.preventDefault(); setUi({ switcherOpen: true }); }
      if (k === 'o') { e.preventDefault(); setUi({ repoPicker: true }); }
      if (e.key === ';') { e.preventDefault(); sideChat(); }
      if (e.code === 'KeyB' && e.altKey) { e.preventDefault(); toggleChat(); }
      else if (k === 'b') { e.preventDefault(); toggleSidebar(); }
      if (k === 'j') { e.preventDefault(); toggleTerminal(); }
      if (k === 'e') { e.preventDefault(); switchEditor(); }
      if (k === 'i') { e.preventDefault(); command('assistant'); setTimeout(() => window.dispatchEvent(new Event('assistant:focus')), 50); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
