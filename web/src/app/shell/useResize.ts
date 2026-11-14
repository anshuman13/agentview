import { useEffect, useState, type PointerEvent } from 'react';
import { save, stored } from '../../ui/util';

function drag(e: PointerEvent, move: (ev: globalThis.PointerEvent) => void, cls: string) {
  e.preventDefault();
  document.body.classList.add(cls);
  const up = () => {
    document.body.classList.remove(cls);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

export function useResize() {
  const [chatW, setChatW] = useState(() => stored<number>('agentview.chatW', 480) || 480);
  const [termH, setTermH] = useState(() => stored<number>('agentview.termH', 240) || 240);
  const [sideW, setSideW] = useState(() => stored<number>('agentview.sideW', 300) || 300);

  useEffect(() => {
    save('agentview.chatW', chatW);
    save('agentview.termH', termH);
    save('agentview.sideW', sideW);
  }, [chatW, termH, sideW]);

  const startResize = (e: PointerEvent) => drag(e, (ev) => setChatW(Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, 360), window.innerWidth - 420))), 'resizing');
  const startTermResize = (e: PointerEvent) => drag(e, (ev) => setTermH(Math.round(Math.min(Math.max(window.innerHeight - 22 - ev.clientY, 100), window.innerHeight - 200))), 'resizing-v');
  const startSideResize = (e: PointerEvent) => {
    const left = (e.currentTarget.previousElementSibling as HTMLElement).getBoundingClientRect().left;
    drag(e, (ev) => setSideW(Math.round(Math.min(Math.max(ev.clientX - left, 200), 640))), 'resizing');
  };
  return { chatW, termH, sideW, startResize, startTermResize, startSideResize };
}
