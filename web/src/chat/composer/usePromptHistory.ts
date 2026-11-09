import { useEffect, useMemo, useRef, useState } from 'react';
import { getState, useStore } from '../../app/store';
import { storedStrings } from '../../ui/util';
import { buildHistory, readDraft, saveDraft, STORED_KEY } from './composerLogic';

type Hist = { list: string[]; index: number; draft: string };

export function useDraft(chat: string, onChatChange: () => void) {
  const [text, setText] = useState(() => readDraft(chat));
  const draftFor = useRef(chat);
  useEffect(() => {
    if (draftFor.current === chat) return saveDraft(chat, text);
    draftFor.current = chat;
    setText(readDraft(chat));
    onChatChange();
  }, [chat, text]);
  return [text, setText] as const;
}

export function usePromptHistory(chat: string) {
  const userCount = useStore((s) => s.events.reduce((n, e) => n + (e.kind === 'user' ? 1 : 0), 0));
  const [sentHistory, setSentHistory] = useState(() => storedStrings(STORED_KEY));
  const [hist, setHist] = useState<Hist | null>(null);
  const history = useMemo(() => buildHistory(getState().events, sentHistory), [chat, userCount, sentHistory]);

  const step = (dir: 1 | -1, text: string, apply: (next: string) => void) => {
    const h = hist ?? { list: history, index: -1, draft: text };
    const index = Math.min(h.list.length - 1, h.index + dir);
    if (index < 0) { setHist(null); apply(h.draft); return; }
    setHist({ ...h, index });
    apply(h.list[index]);
  };

  return { sentHistory, setSentHistory, hist, setHist, history, step };
}
