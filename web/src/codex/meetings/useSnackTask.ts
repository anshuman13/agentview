import { useState } from 'react';
import { errorText } from '../data/engine';
import { showSnack } from '../view';

export function useSnackTask() {
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<void>, failText: string) => {
    setBusy(true);
    try {
      await task();
    } catch (err) {
      showSnack(`${failText}: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}
