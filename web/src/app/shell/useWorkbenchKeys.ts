import { useEffect } from 'react';
import { setUi } from '../store';
import { sideChat } from '../../chat/chatActions';
import { command } from '../../ui/util';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

type Toggles = {
  toggleChat: () => void;
  toggleSidebar: () => void;
  toggleTerminal: () => void;
  switchEditor: () => void;
};

export function useWorkbenchKeys({ toggleChat, toggleSidebar, toggleTerminal, switchEditor }: Toggles) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(MAC ? e.metaKey : e.ctrlKey)) return;
      const k = e.key.toLowerCase();
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
