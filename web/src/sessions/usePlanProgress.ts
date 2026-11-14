import { useEffect, useState } from 'react';
import { specProgress, specTasks } from '../../../shared/specTasks';
import { useStore } from '../app/store';
import { fileRequest } from '../workspace/fileApi';

type PlanRead = { markdown: string | null; progress: string | null; error: boolean };

// A plan file's text and "N of M done" (null without tasks), read again when a file changes.
export function usePlanProgress(path: string | null, chat?: string): PlanRead {
  const [read, setRead] = useState<PlanRead>({ markdown: null, progress: null, error: false });
  // Only a change to the plan itself reloads it.
  const changed = useStore((s) => (path && s.recentFiles[0] && path.endsWith(s.recentFiles[0]) ? s.recentFiles : null));
  useEffect(() => {
    if (!path) return;
    let live = true;
    fileRequest(path, undefined, chat)
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => {
        if (!live) return;
        if (!f || f.error) return setRead((r) => ({ ...r, error: true }));
        const markdown: string = f.content ?? '';
        const tasks = specTasks(markdown);
        setRead({ markdown, progress: tasks.length ? specProgress(tasks) : null, error: false });
      })
      .catch(() => live && setRead((r) => ({ ...r, error: true })));
    return () => { live = false; };
  }, [path, chat, changed]);
  return read;
}
