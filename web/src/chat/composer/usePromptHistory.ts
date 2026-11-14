import { useEffect, useMemo, useRef, useState } from 'react';
import { getState, useStore } from '../../app/store';
import { storedStrings } from '../../ui/util';
import { buildHistory, readDraft, saveDraft, STORED_KEY } from './composerLogic';
import type { ChatEvent } from '../../../../shared/protocol';

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

function lastPromptId(events: ChatEvent[]) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === 'user') return events[i].id;
}

export function usePromptHistory(chat: string) {
  // The last prompt's id changes when a prompt is sent, so the history rebuilds then and not on each append.
  const lastPrompt = useStore((s) => lastPromptId(s.events));
  const [sentHistory, setSentHistory] = useState(() => storedStrings(STORED_KEY));
  const [hist, setHist] = useState<Hist | null>(null);
  const history = useMemo(() => buildHistory(getState().events, sentHistory), [chat, lastPrompt, sentHistory]);

  const step = (dir: 1 | -1, text: string, apply: (next: string) => void) => {
    const h = hist ?? { list: history, index: -1, draft: text };
    const index = Math.min(h.list.length - 1, h.index + dir);
    if (index < 0) { setHist(null); apply(h.draft); return; }
    setHist({ ...h, index });
    apply(h.list[index]);
  };

  return { sentHistory, setSentHistory, hist, setHist, history, step };
}
