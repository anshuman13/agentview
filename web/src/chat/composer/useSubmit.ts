import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { api, notice, prompt, queueNext, steer, useStore } from '../../app/store';
import { save } from '../../ui/util';
import { remember, STORED_KEY, withUses, type Use } from './composerLogic';
import { runInTerminal } from '../chatApi';

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
  clear: () => void;
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

  const sendPrompt = (t: string, stop: boolean, voice: boolean) => {
    const lost = record(t);
    const used = withUses(t, i.uses);
    if (running && (stop || waiting)) steer(used, lost);
    else if (running) queueNext(used, lost, voice);
    else prompt(used, lost, voice);
    if (used !== t) i.setUses([]);
  };

  const submit = (stop = false, voice = false) => {
    const t = i.text.trim();
    if (!t) { sendAfter.current = null; return; }
    if (i.uploading > 0) { sendAfter.current = stop; return; }
    sendAfter.current = null;
    if (i.shell) {
      const cmd = t.slice(1).trim();
      if (cmd) runInTerminal(cmd, true).catch(() => notice('Terminal unavailable'));
    } else {
      sendPrompt(t, stop, voice);
    }
    i.clearHistoryStep();
    i.clear();
  };

  useEffect(() => {
    if (i.uploading === 0 && sendAfter.current !== null) submit(sendAfter.current);
  }, [i.uploading]);

  return { submit };
}
