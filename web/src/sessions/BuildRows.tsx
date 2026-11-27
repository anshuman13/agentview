import { useEffect, useState } from 'react';
import type { SpawnedBuild } from '../../../shared/protocol';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import { fetchSpawnedBuilds } from '../chat/chatApi';
import { buildRows } from '../chat/transcript/buildCardLogic';
import { showChat } from './openChat';
import type { BuildsState } from './folders';

// The open builds a chat started, as indented rows under its row; a tap opens the build chat.
export function BuildRows({ sessionId, members, state }: { sessionId?: string; members?: string[]; state: BuildsState }) {
  const [builds, setBuilds] = useState<SpawnedBuild[]>([]);
  const has = !!sessionId && !!members?.length;
  useEffect(() => {
    if (!has) return setBuilds([]);
    let live = true;
    const load = () => fetchSpawnedBuilds(sessionId).then((b) => { if (live) setBuilds(b); }).catch(() => {});
    load();
    const every = setInterval(load, 30_000);
    return () => { live = false; clearInterval(every); };
  }, [has, sessionId, state]);
  const rows = buildRows(builds);
  if (!has || !rows.length) return null;
  return (
    <>
      {rows.map((b) => (
        <div key={b.sessionId} className="chat-row chat-build">
          <Row lines={1} data-chat-row title={b.title} meta={b.meta || undefined} leading={<Icon name="tools" small />}
            state={<span className={`chat-run ${b.needs ? 'warn' : ''}`}>{b.status === 'Running' && <Icon name="sync" small />}{b.status}</span>}
            onClick={() => showChat(b.chatId ? { chatId: b.chatId, sessionId: b.sessionId } : { sessionId: b.sessionId })} />
        </div>
      ))}
    </>
  );
}
