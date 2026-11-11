import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { fetchBuild } from './sessionApi';

const POLL_MS = 15_000;

export function useBuild(slug: string, shown: boolean, bump = 0) {
  const chat = useStore((s) => s.session.id);
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchBuild>>>(null);
  const [failed, setFailed] = useState(false);
  const [gone, setGone] = useState(false);
  const reload = useCallback(() => fetchBuild(slug).then((v) => { setData(v); setGone(v === null); setFailed(false); }, () => setFailed(true)), [slug]);
  const polling = data !== null && data.summary.state === 'running';
  useEffect(() => { if (shown) void reload(); }, [shown, chat, reload, bump]);
  useEffect(() => {
    if (!shown || !polling) return;
    const t = setInterval(() => !document.hidden && reload(), POLL_MS);
    return () => clearInterval(t);
  }, [shown, polling, reload]);
  return { data, failed, gone, reload };
}
