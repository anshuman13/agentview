import { useMemo } from 'react';
import { send, useStore } from '../../app/store';
import { countChat, useCounts } from '../../app/store/counts';
import { chatBucket } from '../../../../shared/counts';
import { chatLine } from '../../sessions/folders';
import { Badge } from '../../ui/Badge';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { showChat } from '../../ui/util';

// Chats that run or wait on me, waiting ones first.
export function RunningChats() {
  const live = useStore((s) => s.live);
  const { running, waiting } = useCounts();
  const chats = useMemo(() => {
    const rows = live.flatMap((c) => { const b = chatBucket(countChat(c, {})); return b ? [{ c, waits: b === 'waiting' }] : []; });
    return rows.sort((a, b) => Number(b.waits) - Number(a.waits));
  }, [live]);
  if (!chats.length) return null;
  return (
    <section>
      <Section label="Running" count={running + waiting} />
      <div className="as-group">
        {chats.map(({ c, waits }) => (
          <Row key={c.id} title={c.title} meta={`${c.cwd.split('/').pop()} · ${waits ? 'Waiting for you' : chatLine(c, null).text || 'Working'}`}
            trailing={waits ? <Badge status="waiting" label="Needs you" /> : <Badge status="running" />}
            onClick={() => { send({ type: 'view', id: c.id }); showChat(); }} />
        ))}
      </div>
    </section>
  );
}
