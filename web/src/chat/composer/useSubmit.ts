import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { api, notice, prompt, queueNext, steer, useStore } from '../../app/store';
import { save } from '../../ui/util';
import { wsUrl } from '../../app/api';
import { buildPrompt } from '../../../../shared/specTasks';
import { remember, STORED_KEY, terminalId, withUses, type Use } from './composerLogic';

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
  sentHistory: string[];
  setSentHistory: (list: string[]) => void;
  clearHistoryStep: () => void;
  apply: (next: string) => void;
};

export function useSubmit(i: Input) {
  const running = useStore((s) => s.session.running);
  const waiting = useStore((s) => s.pending.length > 0);
  const sendAfter = useRef<boolean | null>(null);

  const record = (t: string) => {
    const next = remember(t, i.sentHistory);
    i.setSentHistory(next);
    save(STORED_KEY, next);
    return () => i.setText((cur) => (cur.trim() ? cur : t));
  };

  const sendPrompt = (t: string, stop: boolean) => {
    const lost = record(t);
    const used = withUses(t, i.uses);
    if (running && (stop || waiting)) steer(used, lost);
    else if (running) queueNext(used, lost);
    else prompt(used, lost);
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

  const sendBuild = () => {
    const brief = i.text.trim();
    if (!brief) return notice('Type the brief in the composer first');
    if (i.uploading > 0) return notice('Wait for the upload to finish');
    const lost = record(brief);
    const used = buildPrompt(withUses(brief, i.uses));
    if (running) queueNext(used, lost);
    else prompt(used, lost);
    i.setUses([]);
    i.clearHistoryStep();
    i.apply('');
  };

  useEffect(() => {
    if (i.uploading === 0 && sendAfter.current !== null) submit(sendAfter.current);
  }, [i.uploading]);

  return { submit, sendBuild };
}
