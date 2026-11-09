import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { api, notice, prompt, queueNext, steer, useStore } from '../../app/store';
import { save, wsUrl } from '../../ui/util';
import { goalText, remember, STORED_KEY, terminalId, withUses, type GoalChoice, type Use } from './composerLogic';

async function runInTerminal(cmd: string) {
  const id = await terminalId(api);
  if (!id) return notice('Terminal unavailable');
  window.dispatchEvent(new CustomEvent('agentview:terminal', { detail: id }));
  const ws = new WebSocket(wsUrl(`term=${encodeURIComponent(id)}`));
  ws.onerror = () => notice('Terminal unavailable');
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'i', d: `${cmd}\r` }));
    ws.close();
  };
}

type Input = {
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  shell: boolean;
  uploading: number;
  uses: Use[];
  setUses: (uses: Use[]) => void;
  goal: GoalChoice;
  resetGoal: () => void;
  sentHistory: string[];
  setSentHistory: (list: string[]) => void;
  clearHistoryStep: () => void;
  apply: (next: string) => void;
};

export function useSubmit(i: Input) {
  const running = useStore((s) => s.session.running);
  const waiting = useStore((s) => s.pending.length > 0);
  const sendAfter = useRef<boolean | null>(null);

  const sendPrompt = (t: string, stop: boolean) => {
    const next = remember(t, i.sentHistory);
    i.setSentHistory(next);
    save(STORED_KEY, next);
    const used = withUses(t, i.uses);
    const full = goalText(i.goal, used, Date.now());
    if (full !== used) i.resetGoal();
    const lost = () => i.setText((cur) => (cur.trim() ? cur : t));
    if (running && (stop || waiting)) steer(full, lost);
    else if (running) queueNext(full, lost);
    else prompt(full, lost);
    if (used !== t) i.setUses([]);
  };

  const submit = (stop = false) => {
    const t = i.text.trim();
    if (!t) { sendAfter.current = null; return; }
    if (i.uploading > 0) { sendAfter.current = stop; return; }
    sendAfter.current = null;
    if (i.shell) {
      const cmd = t.slice(1).trim();
      if (cmd) runInTerminal(cmd).catch(() => notice('Terminal unavailable'));
    } else {
      sendPrompt(t, stop);
    }
    i.clearHistoryStep();
    i.apply('');
  };

  useEffect(() => {
    if (i.uploading === 0 && sendAfter.current !== null) submit(sendAfter.current);
  }, [i.uploading]);

  return submit;
}
