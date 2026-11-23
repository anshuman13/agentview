import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { api, notice, prompt, queueNext, steer, useStore } from '../../app/store';
import { save } from '../../ui/util';
import { loopAt } from '../../../../shared/util';
import { buildPrompt } from '../../../../shared/specTasks';
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
    i.clear();
  };

  const sendLater = (time: string) => {
    const t = i.text.trim();
    if (!t) return;
    if (i.uploading > 0) return notice('Wait for the upload to finish');
    const lost = record(t);
    prompt(loopAt(time, withUses(t, i.uses)), lost);
    i.setUses([]);
    i.clearHistoryStep();
    i.clear();
  };

  useEffect(() => {
    if (i.uploading === 0 && sendAfter.current !== null) submit(sendAfter.current);
  }, [i.uploading]);

  return { submit, sendBuild, sendLater };
}
