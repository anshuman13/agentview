import { useState } from 'react';
import { send, useStore } from '../../app/store';
import { IconButton } from '../../ui/Button';
import { Confirm, type ConfirmRequest } from '../../ui/Confirm';
import { providerLabel } from '../../../../shared/providers';
import type { Rewind } from './steps';

const request = ({ id, prompt }: Rewind, label: string): ConfirmRequest => ({
  title: 'Rewind files?',
  detail: `Puts every file ${label} changed back to how it was before "${prompt.split('\n')[0].slice(0, 80)}". Edits from later turns are undone too; the conversation stays.`,
  action: 'Rewind',
  icon: 'discard',
  run: async () => send({ type: 'rewind', id }),
});

export function RewindLink({ rewind }: { rewind: Rewind }) {
  const label = useStore((s) => providerLabel(s.session.provider));
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  return (
    <>
      <IconButton icon="discard" label="Rewind files" title="Put the files back to how they were before this prompt" onClick={() => setAsk(request(rewind, label))} />
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </>
  );
}
