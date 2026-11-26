import { useEffect, useState } from 'react';
import type { SpawnedBuild } from '../../../../shared/protocol';
import { useStore } from '../../app/store';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { showChat } from '../../sessions/openChat';
import { fetchSpawnedBuilds } from '../chatApi';
import { buildCard } from './buildCardLogic';
import { BUILD_TOOL, str, type ToolResult, type ToolUse } from './steps';

// A build the agent started with start_build: its spec, state, task and last round, and Open for the build chat.
export function BuildCard({ use, result }: { use: ToolUse; result?: ToolResult }) {
  const sessionId = useStore((s) => s.session.sessionId);
  const index = useStore((s) => s.events.filter((e) => e.kind === 'tool_use' && e.name === BUILD_TOOL).findIndex((e) => e.id === use.id));
  const tick = useStore((s) => s.events.length);
  const [builds, setBuilds] = useState<SpawnedBuild[]>([]);
  const card = buildCard({ spec: str(use.input.spec) || undefined, request: str(use.input.request) || undefined }, result?.text, Math.max(index, 0), builds);
  const active = card.status !== 'Done' && card.status !== 'Stopped';

  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    const load = () => fetchSpawnedBuilds(sessionId).then((b) => { if (live) setBuilds(b); }).catch(() => {});
    const soon = setTimeout(load, 500);
    const every = active ? setInterval(load, 30_000) : undefined;
    return () => { live = false; clearTimeout(soon); clearInterval(every); };
  }, [sessionId, tick, active]);

  const open = card.open;
  const meta = [card.tasks, card.round].filter(Boolean).join(' · ');
  return (
    <div className="ui-group tr-act">
      <Row plain leading={<Icon name="tools" />} title={card.title ? `Build: ${card.title}` : 'Build'} lines={1}
        trailing={open && <Button variant="plain" size="sm" onClick={() => showChat('chat' in open ? { chatId: open.chat } : { sessionId: open.session })}>Open</Button>} />
      <div className="tr-alarm-body">
        <div className="tr-alarm-label">{card.status}</div>
        {meta && <div className="tr-alarm-status" title={meta}>{meta}</div>}
      </div>
    </div>
  );
}
