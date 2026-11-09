import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getState, useStore } from '../../app/store';
import { listFiles } from '../../workspace/fileApi';
import { fetchSavedSessions } from '../chatApi';
import type { SavedSession } from '../../../../shared/protocol';
import { chatQuery, fileCache, rankChats, rankCommands, rankFiles, triggerAt } from './composerLogic';

export function useAutocomplete(text: string, caret: number) {
  const cwd = useStore((s) => s.session.cwd);
  const commands = useStore((s) => s.session.commands);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [chats, setChats] = useState<SavedSession[]>([]);
  const card = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLUListElement>(null);

  const at = Math.min(caret, text.length);
  const trigger = useMemo(() => triggerAt(text, at), [text, at]);
  const shell = trigger?.kind === 'shell';
  const popKey = trigger && trigger.kind !== 'shell' ? `${trigger.kind}:${trigger.start}:${trigger.query}` : '';
  const chatQ = chatQuery(trigger);
  const items = useMemo(() => {
    if (!trigger || trigger.kind === 'shell' || popKey === dismissed) return [];
    if (chatQ !== null) return rankChats(chats.filter((c) => c.sessionId !== getState().session.sessionId), chatQ);
    return trigger.kind === 'command' ? rankCommands(commands, trigger.query) : rankFiles(files, trigger.query);
  }, [trigger, popKey, dismissed, commands, files, chats, chatQ]);

  useEffect(() => {
    if (trigger?.kind !== 'file' || !cwd) return;
    let live = true;
    setFiles(fileCache.get(cwd) ?? []);
    listFiles().then((f: string[]) => { fileCache.set(cwd, f); if (live) setFiles(f); }).catch(() => {});
    return () => void (live = false);
  }, [trigger?.kind, cwd]);

  const wantChats = chatQ !== null;
  useEffect(() => {
    if (!wantChats) return;
    let live = true;
    fetchSavedSessions().then((l: SavedSession[]) => { if (live && Array.isArray(l)) setChats(l); }).catch(() => {});
    return () => void (live = false);
  }, [wantChats]);

  useEffect(() => setSel(0), [popKey]);

  useEffect(() => {
    pop.current?.children[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  useLayoutEffect(() => {
    const el = pop.current;
    const anchor = card.current;
    if (!el || !anchor) return;
    const r = anchor.getBoundingClientRect();
    el.style.left = `${r.left}px`;
    el.style.width = `${r.width}px`;
    if (r.top - 8 >= el.offsetHeight) { el.style.bottom = `${window.innerHeight - r.top + 4}px`; el.style.top = ''; }
    else { el.style.top = `${r.bottom + 4}px`; el.style.bottom = ''; }
  }, [items]);

  return { at, trigger, shell, popKey, items, open: items.length > 0, sel, setSel, setDismissed, card, pop };
}
