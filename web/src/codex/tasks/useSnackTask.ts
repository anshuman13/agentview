import { useState } from 'react';
import { attempt } from '../view';

// A busy flag around a change that reports its failure in the snack.
export function useSnackTask() {
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<void>, failText: string) => {
    setBusy(true);
    await attempt(task, failText);
    setBusy(false);
  };
  return [busy, run] as const;
}
