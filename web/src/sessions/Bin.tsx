import { useEffect, useState } from 'react';
import { deleteRequest } from './sessionApi';
import { notice } from '../app/store';
import { Icon } from '../ui/Icon';
import { Button, IconButton } from '../ui/Button';
import { chatMatches } from '../../../shared/chatSearch';
import { queryWords } from '../../../shared/match';
import type { ConfirmRequest } from '../ui/Confirm';
import type { BinnedSession } from '../../../shared/protocol';
import { pressable } from '../ui/util';
import { binLeft, deleteChat, get, repoName, restoreChat, type Folder } from './folders';
import { metaLine } from './ChatRows';

// While the Sessions search has text, the bin shows only its chats that match, behind a "Show N in the bin" row.
export function Bin({ folders, filter, ask, onRestore }: { folders: Folder[]; filter: string; ask: (r: ConfirmRequest) => void; onRestore: (b: BinnedSession) => void }) {
  const [list, setList] = useState<BinnedSession[]>([]);
  const [open, setOpen] = useState(false);
  const searching = queryWords(filter).length > 0;
  useEffect(() => setOpen(false), [searching]);
  useEffect(() => {
    const load = () => get('/api/sessions/bin').then((x) => x && setList(x));
    load();
    window.addEventListener('agentview:bin', load);
    return () => window.removeEventListener('agentview:bin', load);
  }, []);
  const shown = searching ? list.filter((b) => chatMatches(filter, b.title, null, repoName(folders, b.cwd))) : list;
  if (!shown.length) return null;
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
  const rows = open && shown.map((b) => (
    <BinRow key={b.sessionId} b={b} folders={folders} onRestore={() => restore(b)} onDelete={() => ask(deleteChat(b, () => setList((l) => l.filter((x) => x.sessionId !== b.sessionId)), notice, true))} />
  ));
  if (searching) return (
    <div className="bin">
      <Button variant="quiet" size="sm" className="more" onClick={() => setOpen((v) => !v)}>{open ? 'Hide the bin' : `Show ${shown.length} in the bin`}</Button>
      {rows}
    </div>
  );
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
      {rows}
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
