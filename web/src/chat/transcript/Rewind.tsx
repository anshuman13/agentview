import { useState } from 'react';
import { useStore } from '../../app/store';
import { forkWithDraft } from '../../app/newChat';
import { insertText, rewindFiles } from '../chatActions';
import { fetchRewindPreview } from '../chatApi';
import { useCan } from '../useCan';
import { IconButton } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { providerLabel } from '../../../../shared/providers';
import type { RewindPreview } from '../../../../shared/protocol';
import { RESTORE_LABEL, restorePlan, rewindTotal, type RestoreChoice, type Rewind } from './steps';

const DETAIL: Record<RestoreChoice, (label: string, first: string) => string> = {
  code: (label, first) => `Puts every file ${label} changed back to how it was before "${first}" and puts that prompt back in the composer. Edits from later turns are undone too; the conversation stays.`,
  conversation: (_, first) => `Opens a new chat from before "${first}" with that prompt in its composer. Files stay as they are and this chat stays as it is.`,
  both: (label, first) => `Puts every file ${label} changed back to how it was before "${first}" and opens a new chat from before that prompt with it in the composer. This chat stays as it is.`,
};

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

function RewindDialog({ rewind: { id, prompt, before }, preview, onClose }: { rewind: Rewind; preview: RewindPreview | null; onClose: () => void }) {
  const label = useStore((s) => providerLabel(s.session.provider));
  const canFork = useCan('forkAt');
  const [choice, setChoice] = useState<RestoreChoice>('code');
  const plan = restorePlan(choice, canFork, !!before);
  const first = prompt.split('\n')[0].slice(0, 80);
  return (
    <Confirm
      title="Rewind to this message?"
      detail={DETAIL[plan.fork ? (plan.files ? 'both' : 'conversation') : 'code'](label, first)}
      body={
        <>
          {plan.choices.length > 1 && (
            <div className="rewind-restore" role="radiogroup" aria-label="Restore">
              {plan.choices.map((c) => <button key={c} role="radio" aria-checked={choice === c} className={choice === c ? 'on' : ''} onClick={() => setChoice(c)}>{RESTORE_LABEL[c]}</button>)}
            </div>
          )}
          {preview && 'files' in preview && plan.files && <RewindFiles {...preview} />}
        </>
      }
      {...(preview && 'error' in preview && plan.files && { warning: preview.error })}
      action="Rewind"
      icon="discard"
      run={async () => {
        if (plan.files) rewindFiles(id);
        if (plan.fork && before) forkWithDraft(before, prompt);
        else insertText(prompt);
      }}
      onClose={onClose}
    />
  );
}

export function RewindLink({ rewind }: { rewind: Rewind }) {
  const [preview, setPreview] = useState<RewindPreview | null | undefined>(undefined);
  const open = async () => setPreview(await fetchRewindPreview(rewind.id).catch(() => null));
  return (
    <>
      <IconButton icon="discard" label="Rewind files" title="Put the files back to how they were before this prompt" onClick={() => void open()} />
      {preview !== undefined && <RewindDialog rewind={rewind} preview={preview} onClose={() => setPreview(undefined)} />}
    </>
  );
}
