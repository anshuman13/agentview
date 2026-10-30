import { useEffect, useState } from 'react';
import { apiUrl } from '../app/api';
import { notice } from '../app/store';
import { Icon } from '../ui/Icon';
import type { ConfirmRequest } from '../ui/Confirm';
import { BIN_MS, type BinnedSession } from '../../../shared/protocol';
import { pressable } from '../ui/util';
import { deleteChat, get } from './folders';

export function Bin({ ask, onRestore }: { ask: (r: ConfirmRequest) => void; onRestore: (b: BinnedSession) => void }) {
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
    const r = await fetch(apiUrl(`/api/sessions/restore?id=${encodeURIComponent(b.sessionId)}`), { method: 'POST' }).catch(() => null);
    if (!r?.ok) return notice('Could not restore the chat');
    setList((l) => l.filter((x) => x.sessionId !== b.sessionId));
    onRestore(b);
  };
  const empty = () => ask({
    title: 'Empty the bin?',
    detail: `${list.length} ${list.length === 1 ? 'chat' : 'chats'}`,
    warning: 'The transcripts are removed permanently.',
    action: 'Empty bin',
    run: async () => {
      const r = await fetch(apiUrl('/api/sessions/bin'), { method: 'DELETE' }).catch(() => null);
      if (!r?.ok) return notice('Could not empty the bin');
      setList([]);
    },
  });
  const left = (b: BinnedSession) => `${Math.max(1, Math.round((b.deletedAt + BIN_MS - Date.now()) / 3600000))}h left`;
  return (
    <div className="bin">
      <div className="row project" {...pressable(() => setOpen((v) => !v))}>
        <span className="twistie"><Icon name={open ? 'chevron-down' : 'chevron-right'} small /></span>
        <Icon name="trash" small />
        <span className="name">Bin</span>
        <span className="meta"><span className="count">{list.length}</span></span>
        <span className="acts">
          <button className="icon-btn" title="Empty bin" onClick={(e) => { e.stopPropagation(); empty(); }}><Icon name="close" small /></button>
        </span>
      </div>
      {open && list.map((b) => (
        <div key={b.sessionId} className="row session recent" title={`${b.title}\n${b.cwd}\nDeleted for good after 24 hours`}>
          <span className="name">{b.title}</span>
          <span className="when">{left(b)}</span>
          <span className="acts">
            <button className="icon-btn" title="Restore chat" onClick={() => restore(b)}><Icon name="discard" small /></button>
            <button className="icon-btn" title="Delete for good" onClick={() => ask(deleteChat(b, () => setList((l) => l.filter((x) => x.sessionId !== b.sessionId)), notice, true))}><Icon name="close" small /></button>
          </span>
        </div>
      ))}
    </div>
  );
}
