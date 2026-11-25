import { useEffect, useState } from 'react';
import { deleteRequest } from './sessionApi';
import { notice } from '../app/store';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import type { ConfirmRequest } from '../ui/Confirm';
import type { BinnedSession } from '../../../shared/protocol';
import { pressable } from '../ui/util';
import { binLeft, deleteChat, get, repoName, restoreChat, type Folder } from './folders';
import { metaLine } from './ChatRows';

export function Bin({ folders, ask, onRestore }: { folders: Folder[]; ask: (r: ConfirmRequest) => void; onRestore: (b: BinnedSession) => void }) {
  const [list, setList] = useState<BinnedSession[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = () => get('/api/sessions/bin').then((x) => x && setList(x));
    load();
    window.addEventListener('agentview:bin', load);
    return () => window.removeEventListener('agentview:bin', load);
  }, []);
  if (!list.length) return null;
  const restore = async (b: BinnedSession) => {
    if (!(await restoreChat(b.sessionId))) return notice('Could not restore the chat. It is still in the bin.');
    setList((l) => l.filter((x) => x.sessionId !== b.sessionId));
    notice('Chat restored');
    onRestore(b);
  };
  const empty = () => ask({
    title: 'Empty the bin?',
    detail: `${list.length} ${list.length === 1 ? 'chat' : 'chats'}`,
    warning: 'The transcripts are removed permanently.',
    action: 'Empty bin',
    run: async () => {
      const r = await deleteRequest('/api/sessions/bin');
      if (!r?.ok) return notice('Could not empty the bin');
      setList([]);
    },
  });
  return (
    <div className="bin">
      <div className="row project" {...pressable(() => setOpen((v) => !v))}>
        <span className="twistie"><Icon name={open ? 'chevron-down' : 'chevron-right'} small /></span>
        <Icon name="trash" small />
        <span className="name">Bin</span>
        <span className="meta"><span className="count">{list.length}</span></span>
        <span className="acts">
          <IconButton icon="trash" small label="Empty bin" onClick={(e) => { e.stopPropagation(); empty(); }} />
        </span>
      </div>
      {open && list.map((b) => (
        <BinRow key={b.sessionId} b={b} folders={folders} onRestore={() => restore(b)} onDelete={() => ask(deleteChat(b, () => setList((l) => l.filter((x) => x.sessionId !== b.sessionId)), notice, true))} />
      ))}
    </div>
  );
}

export function BinRow({ b, folders, onRestore, onDelete }: { b: BinnedSession; folders: Folder[]; onRestore: () => void; onDelete: () => void }) {
  return (
    <div className="row session recent" title={`${b.title}\n${b.cwd}\nDeleted for good after 7 days`}>
      <span className="name">{b.title || 'Untitled'}</span>
      <span className="when">{metaLine(repoName(folders, b.cwd), binLeft(b.deletedAt))}</span>
      <span className="acts">
        <IconButton icon="discard" small label="Restore chat" onClick={onRestore} />
        <IconButton icon="close" small label="Delete for good" onClick={onDelete} />
      </span>
    </div>
  );
}
