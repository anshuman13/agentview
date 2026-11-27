import { useState } from 'react';
import { useStore } from '../../app/store';
import { insertText, rewindFiles } from '../chatActions';
import { fetchRewindPreview } from '../chatApi';
import { IconButton } from '../../ui/Button';
import { Confirm, type ConfirmRequest } from '../../ui/Confirm';
import { providerLabel } from '../../../../shared/providers';
import type { RewindPreview } from '../../../../shared/protocol';
import { rewindTotal, type Rewind } from './steps';

const request = ({ id, prompt }: Rewind, label: string, preview: RewindPreview | null): ConfirmRequest => ({
  title: 'Rewind to this message?',
  detail: `Puts every file ${label} changed back to how it was before "${prompt.split('\n')[0].slice(0, 80)}" and puts that prompt back in the composer. Edits from later turns are undone too; the conversation stays.`,
  ...(preview && 'files' in preview && { body: <RewindFiles {...preview} /> }),
  ...(preview && 'error' in preview && { warning: preview.error }),
  action: 'Rewind',
  icon: 'discard',
  run: async () => {
    rewindFiles(id);
    insertText(prompt);
  },
});

function RewindFiles({ files, insertions, deletions }: { files: string[]; insertions: number; deletions: number }) {
  return (
    <div className="rewind-files">
      {files.map((f) => <div key={f} className="rewind-file" title={f}>{f}</div>)}
      <div className="rewind-total">
        {rewindTotal(files.length)} <span className="add">+{insertions}</span> <span className="del">−{deletions}</span>
      </div>
    </div>
  );
}

export function RewindLink({ rewind }: { rewind: Rewind }) {
  const label = useStore((s) => providerLabel(s.session.provider));
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const open = async () => setAsk(request(rewind, label, await fetchRewindPreview(rewind.id).catch(() => null)));
  return (
    <>
      <IconButton icon="discard" label="Rewind files" title="Put the files back to how they were before this prompt" onClick={() => void open()} />
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </>
  );
}
