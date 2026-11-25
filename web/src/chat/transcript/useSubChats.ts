import { useCallback, useEffect, useState } from 'react';
import type { ChatEvent } from '../../../../shared/protocol';
import { fetchSubChatEvents, fetchSubChats, fetchTextFile } from '../chatApi';
import { chainSpec, specTasks, type SubChat } from './subChatsLogic';

export type SubFeed = { events: ChatEvent[]; earlier: number; loading: boolean; error?: string };

// The chat's earlier sub-chats, the task lines of their build spec, and the transcripts of the rows the reader expanded.
export function useSubChats(sessionId: string | null) {
  const [subs, setSubs] = useState<SubChat[]>([]);
  const [tasks, setTasks] = useState<string[] | undefined>();
  const [feeds, setFeeds] = useState<Record<string, SubFeed>>({});

  useEffect(() => {
    setSubs([]);
    setTasks(undefined);
    setFeeds({});
    if (!sessionId) return;
    let live = true;
    fetchSubChats(sessionId).then(async (list) => {
      if (!live) return;
      setSubs(list);
      const spec = chainSpec(list);
      if (!spec) return;
      const md = await fetchTextFile(spec).catch(() => '');
      if (live && md) setTasks(specTasks(md));
    }).catch(() => {});
    return () => { live = false; };
  }, [sessionId]);

  const page = useCallback((id: string, before: string) => {
    setFeeds((f) => ({ ...f, [id]: { events: f[id]?.events ?? [], earlier: f[id]?.earlier ?? 0, loading: true } }));
    fetchSubChatEvents(id, before).then(
      (r) => setFeeds((f) => f[id] ? { ...f, [id]: { events: [...r.events, ...(before ? f[id].events : [])], earlier: r.earlier ?? 0, loading: false } } : f),
      (e: Error) => setFeeds((f) => f[id] ? { ...f, [id]: { ...f[id], loading: false, error: e.message } } : f),
    );
  }, []);

  const toggle = useCallback((id: string) => {
    if (!feeds[id]) return page(id, '');
    setFeeds((f) => { const { [id]: _, ...rest } = f; return rest; });
  }, [feeds, page]);

  const open = useCallback((id: string) => { if (!feeds[id]) page(id, ''); }, [feeds, page]);

  const earlier = useCallback((id: string) => {
    const first = feeds[id]?.events[0];
    if (first && !feeds[id].loading) page(id, first.id);
  }, [feeds, page]);

  return { subs, tasks, feeds, toggle, open, earlier };
}
