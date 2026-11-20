import { useEffect, useState } from 'react';
import { loadErrorText } from '../../../shared/loadError';

export type Load<T> = { data: T | null; error: string; busy: boolean };

export function useLoad<T>(load: (() => Promise<T>) | null, key: string): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ data: null, error: '', busy: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!load) return;
    let live = true;
    setState({ data: null, error: '', busy: true });
    load().then(
      (data) => live && setState({ data, error: '', busy: false }),
      (e) => live && setState({ data: null, error: loadErrorText(e.message), busy: false }),
    );
    return () => {
      live = false;
    };
  }, [key, !load, tick]);
  return [state, () => setTick((t) => t + 1)];
}
