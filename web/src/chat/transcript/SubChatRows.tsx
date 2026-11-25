import { useEffect, useMemo, useState } from 'react';
import { findInChat, findStart } from '../../../../shared/findInChat';
import { showTurn } from '../../sessions/openChat';
import { Icon } from '../../ui/Icon';
import { pressable } from '../../ui/util';
import { TranscriptBox } from './Box';
import { markHit, type FindRequest } from './FindBar';
import { Row } from './Transcript';
import { createTranscriptBuilder } from './steps';
import { hitBeforeLoaded } from './window';
import { foldRows, subChatRow, type SubChat } from './subChatsLogic';
import { useSubChats, type SubFeed } from './useSubChats';

// The chat's earlier sub-chats as collapsed rows, oldest first; a tap shows that sub-chat's transcript, read-only.
// `find` is a message search hit in one of them: that row unfolds and opens, loads earlier pages until the hit's time, and scrolls to it.
export function SubChatRows({ sessionId, cwd, find, unstick }: { sessionId: string | null; cwd: string; find: FindRequest | null; unstick: () => void }) {
  const { subs, tasks, feeds, toggle, open, earlier } = useSubChats(sessionId);
  const [unfolded, setUnfolded] = useState(false);
  const { shown, hidden } = foldRows(subs, unfolded);
  const [seek, setSeek] = useState<FindRequest | null>(null);
  useEffect(() => setSeek(find), [find]);
  const target = seek?.sub && subs.some((s) => s.sessionId === seek.sub) ? seek.sub : null;
  const feed = target ? feeds[target] : undefined;
  useEffect(() => {
    if (!seek || !target) return;
    if (!shown.some((s) => s.sessionId === target)) return setUnfolded(true);
    if (!feed) return open(target);
    if (feed.loading) return;
    if (!feed.error && feed.earlier > 0 && hitBeforeLoaded(feed.events, seek.query, seek.at)) return earlier(target);
    setSeek(null);
    const hits = findInChat(feed.events, seek.query, seek.at);
    if (!hits.length) return;
    unstick();
    showTurn(hits[findStart(feed.events, hits, seek.at)], markHit);
  }, [seek, target, shown, feed]);
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
