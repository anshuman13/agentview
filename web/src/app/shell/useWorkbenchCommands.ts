import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { openAgent } from '../../sessions/agents';
import { isPage, pageOn, type Page } from '../pages';
import type { Tab, View } from './TabBar';
import { narrow } from './useNarrow';


type Setter<T> = Dispatch<SetStateAction<T>>;

type Workbench = {
  openAssistant: () => void;
  openPage: (p: Page) => void;
  toggleTheme: () => void;
  setView: Setter<View>;
  setSidebar: Setter<boolean>;
  setTab: Setter<Tab>;
  setEditor: Setter<'file' | 'browser' | 'agents' | 'assistant' | Page>;
  setBrowse: Setter<boolean>;
  setChatOpen: Setter<boolean>;
  setTerminal: Setter<boolean>;
  setPhone: Setter<boolean>;
};

// Runs the commands the palette and shortcuts send as agentview:command events.
export function useWorkbenchCommands(w: Workbench) {
  useEffect(() => {
    const onCommand = (e: Event) => {
      const [kind, arg] = (e as CustomEvent<{ id: string }>).detail.id.split(':');
      if (kind === 'assistant' || (kind === 'view' && arg === 'assistant')) w.openAssistant();
      else if (kind === 'view') showView(w, arg as View);
      else if (kind === 'tab') showTab(w, arg);
      else if (kind === 'page' && isPage(arg) && pageOn(arg)) w.openPage(arg);
      else if (kind === 'terminal') { if (narrow()) w.setTab('term'); else w.setTerminal((v) => !v); }
      else if (kind === 'switchEditor') w.setEditor((v) => (v === 'file' ? 'browser' : 'file'));
      else if (kind === 'phone') w.setPhone((v) => !v);
      else if (kind === 'toggleSidebar') w.setSidebar((v) => !v);
      else if (kind === 'toggleChat') w.setChatOpen((v) => !v);
      else if (kind === 'theme') w.toggleTheme();
    };
    window.addEventListener('agentview:command', onCommand);
    return () => window.removeEventListener('agentview:command', onCommand);
  }, [w.toggleTheme]);
}

function showView(w: Workbench, view: View) {
  w.setView(view);
  w.setSidebar(true);
  if (narrow() && view === 'explorer') { w.setTab('code'); w.setEditor('file'); w.setBrowse(true); }
  else if (narrow()) w.setTab('repos');
}

function showTab(w: Workbench, arg: string) {
  if (arg === 'agents' && !narrow()) return openAgent();
  if (arg === 'chat') w.setChatOpen(true);
  else if (arg === 'term') w.setTerminal(true);
  else w.setEditor(arg === 'code' ? 'file' : (arg as 'browser' | 'agents'));
  if (narrow()) w.setTab(arg as Tab);
  if (arg === 'chat') window.dispatchEvent(new CustomEvent('agentview:focus'));
}
