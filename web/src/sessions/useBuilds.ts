import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../app/store';
import { fetchBuild, fetchBuilds } from './sessionApi';

const POLL_MS = 15_000;

function usePolled<T>(load: () => Promise<T | null>, shown: boolean, running: (data: T) => boolean, bump = 0) {
  const chat = useStore((s) => s.session.id);
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [gone, setGone] = useState(false);
  const loader = useRef(load);
  loader.current = load;
  const reload = useCallback(() => loader.current().then((v) => { setData(v); setGone(v === null); setFailed(false); }, () => setFailed(true)), []);
  const polling = data !== null && running(data);
  useEffect(() => { if (shown) void reload(); }, [shown, chat, reload, bump]);
  useEffect(() => {
    if (!shown || !polling) return;
    const t = setInterval(() => !document.hidden && reload(), POLL_MS);
    return () => clearInterval(t);
  }, [shown, polling, reload]);
  return { data, failed, gone, reload };
}

export const useBuilds = (shown: boolean) => usePolled(fetchBuilds, shown, (rows) => rows.some((b) => b.state === 'running'));

export const useBuild = (slug: string, shown: boolean, bump?: number) => usePolled(() => fetchBuild(slug), shown, (b) => b.summary.state === 'running', bump);
