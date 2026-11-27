import { useEffect, useState } from 'react';
import type { ChatEvent, SpawnedBuild } from '../../../../shared/protocol';
import { Icon } from '../../ui/Icon';
import { pressable } from '../../ui/util';
import { showChat } from '../../sessions/openChat';
import { fetchSpawnedBuilds } from '../chatApi';
import { buildRows } from './buildCardLogic';
import { BUILD_TOOL } from './steps';

// Pinned under the chat header while a build this chat started is open: spec, task, state and last round; a tap opens the build chat.
export function BuildBar({ sessionId, events }: { sessionId: string | null; events: ChatEvent[] }) {
  const [builds, setBuilds] = useState<SpawnedBuild[]>([]);
  const started = events.filter((e) => e.kind === 'tool_use' && e.name === BUILD_TOOL).length;
  const rows = buildRows(builds);
  const open = rows.length > 0;
  useEffect(() => {
    if (!sessionId) return setBuilds([]);
    let live = true;
    const load = () => fetchSpawnedBuilds(sessionId).then((b) => { if (live) setBuilds(b); }).catch(() => {});
    load();
    const every = open ? setInterval(load, 30_000) : undefined;
    return () => { live = false; clearInterval(every); };
  }, [sessionId, started, open]);
  if (!open) return null;
  return (
    <div className="tr-buildbar">
      {rows.map((b) => (
        <div key={b.sessionId} className="tr-buildbar-row" title={b.meta} {...pressable(() => showChat(b.chatId ? { chatId: b.chatId, sessionId: b.sessionId } : { sessionId: b.sessionId }))}>
          <Icon name="tools" small />
          <span className="tr-buildbar-title">{b.title}</span>
          {b.meta && <span className="tr-buildbar-meta">{b.meta}</span>}
          <span className={`chat-run ${b.needs ? 'warn' : ''}`}>{b.status}</span>
          <Icon name="chevron-right" small />
        </div>
      ))}
    </div>
  );
}
