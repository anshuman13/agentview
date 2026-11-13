import { useState } from 'react';
import { send } from '../../app/store';
import { Confirm, type ConfirmRequest } from '../../ui/Confirm';
import type { Rewind } from './steps';

const request = ({ id, prompt }: Rewind): ConfirmRequest => ({
  title: 'Rewind files?',
  detail: `Puts every file the agent changed back to how it was before "${prompt.split('\n')[0].slice(0, 80)}". Edits from later turns are undone too; the conversation stays.`,
  action: 'Rewind',
  icon: 'discard',
  run: async () => send({ type: 'rewind', id }),
});

export function RewindLink({ rewind }: { rewind: Rewind }) {
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <button className="link" title="Put the files back to how they were before this prompt" onClick={() => setAsk(request(rewind))}>Rewind files</button>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </>
  );
}
