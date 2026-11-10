import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../app/store';
import { isSketchPath } from '../../../shared/sketches';
import { fetchSketches, readSketch, type SketchFile } from './fileApi';

const MAX_SKETCH = 1_000_000;

export function useSketches(shown: boolean) {
  const chat = useStore((s) => s.session.id);
  const recent = useStore((s) => s.recentFiles);
  const changed = isSketchPath(recent[0] ?? '') ? recent : null;
  const [data, setData] = useState<SketchFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const reload = useCallback(() => {
    const mine = ++latest.current;
    return fetchSketches().then(
      (list) => { if (mine === latest.current) { setData(list); setError(null); } return list; },
      (e) => { if (mine === latest.current) setError(e instanceof Error ? e.message : String(e)); return null; },
    );
  }, []);
  useEffect(() => { if (shown) void reload(); }, [shown, chat, changed, reload]);
  return { data, error, reload };
}

// The file's text, read again when the agent rewrites it.
export function useSketch(path: string) {
  const recent = useStore((s) => s.recentFiles);
  const changed = recent[0]?.endsWith(path) ? recent : null;
  const [html, setHtml] = useState<string | null>(null);
  const [problem, setProblem] = useState<'failed' | 'large' | null>(null);
  useEffect(() => {
    let stale = false;
    readSketch(path).then(
      (f) => {
        if (stale) return;
        setHtml(f.content);
        setProblem(f.binary ? 'failed' : f.content.length > MAX_SKETCH ? 'large' : null);
      },
      () => !stale && setProblem('failed'),
    );
    return () => { stale = true; };
  }, [path, changed]);
  return { html, problem };
}
