import { useEffect, useState } from 'react';
import { specProgress, specTasks } from '../../../shared/specTasks';
import { useStore } from '../app/store';
import { fileRequest } from '../workspace/fileApi';

// "N of M done" for a plan file, read again when a file changes.
export function usePlanProgress(path: string | null, chat?: string) {
  const [progress, setProgress] = useState<string | null>(null);
  const changed = useStore((s) => s.recentFiles);
  useEffect(() => {
    if (!path) return;
    let live = true;
    fileRequest(path, undefined, chat)
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => live && f && setProgress(specProgress(specTasks(f.content ?? ''))))
      .catch(() => {});
    return () => { live = false; };
  }, [path, chat, changed]);
  return progress;
}
