import { useMemo, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { pressable } from '../../ui/util';
import { TranscriptBox } from './Box';
import { Row } from './Transcript';
import { createTranscriptBuilder } from './steps';
import { foldRows, subChatRow, type SubChat } from './subChatsLogic';
import { useSubChats, type SubFeed } from './useSubChats';

// The chat's earlier sub-chats as collapsed rows, oldest first; a tap shows that sub-chat's transcript, read-only.
export function SubChatRows({ sessionId, cwd }: { sessionId: string | null; cwd: string }) {
  const { subs, tasks, feeds, toggle, earlier } = useSubChats(sessionId);
  const [unfolded, setUnfolded] = useState(false);
  const { shown, hidden } = foldRows(subs, unfolded);
  if (!subs.length) return null;
  return (
    <div className="tr-subs">
      {hidden > 0 && <div className="tr-more" {...pressable(() => setUnfolded(true))}>{`Show ${hidden} earlier`}</div>}
      {shown.map((s) => <SubChatRow key={s.sessionId} sub={s} tasks={tasks} feed={feeds[s.sessionId]} cwd={cwd} onToggle={() => toggle(s.sessionId)} onEarlier={() => earlier(s.sessionId)} />)}
    </div>
  );
}

function SubChatRow({ sub, tasks, feed, cwd, onToggle, onEarlier }: { sub: SubChat; tasks?: string[]; feed?: SubFeed; cwd: string; onToggle: () => void; onEarlier: () => void }) {
  const [title, ...meta] = subChatRow(sub, tasks);
  return (
    <TranscriptBox id={`sub:${sub.sessionId}`} className="tr-sub" title={title} meta={meta.join(' · ') || undefined} open={!!feed} onToggle={onToggle}>
      {feed && <SubFeedRows feed={feed} cwd={cwd} onEarlier={onEarlier} />}
    </TranscriptBox>
  );
}

function SubFeedRows({ feed, cwd, onEarlier }: { feed: SubFeed; cwd: string; onEarlier: () => void }) {
  const [build] = useState(createTranscriptBuilder);
  const items = useMemo(() => build(feed.events).filter((it) => it.kind !== 'blocked' && it.kind !== 'review'), [build, feed.events]);
  return (
    <div className="tr-sub-feed">
      {feed.earlier > 0 && <div className="tr-more" {...pressable(onEarlier)}>{feed.loading ? <><Icon name="loading" small spin /> Loading earlier…</> : `Show earlier (${feed.earlier} hidden)`}</div>}
      {feed.loading && !items.length && <div className="tr-more"><Icon name="loading" small spin /> Loading…</div>}
      {feed.error && <div className="tr-system err">{feed.error}</div>}
      {items.map((it) => <Row key={it.id} it={it} cwd={cwd} settled readOnly />)}
    </div>
  );
}
