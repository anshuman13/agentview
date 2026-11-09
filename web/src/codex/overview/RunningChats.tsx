import { useMemo } from 'react';
import { send, useStore } from '../../app/store';
import { chatLine, chatState } from '../../sessions/folders';
import { Badge } from '../../ui/Badge';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { showChat } from '../../ui/util';

// Chats that run or wait on me, waiting ones first.
export function RunningChats() {
  const live = useStore((s) => s.live);
  const chats = useMemo(() => live.filter((c) => c.pending || chatState({ live: c }, {}) === 'running').sort((a, b) => Number(!!b.pending) - Number(!!a.pending)), [live]);
  if (!chats.length) return null;
  return (
    <section>
      <Section label="Running" count={chats.length} />
      <div className="as-group">
        {chats.map((c) => (
          <Row key={c.id} title={c.title} meta={`${c.cwd.split('/').pop()} · ${c.pending ? 'Waiting for you' : chatLine(c, null).text || 'Working'}`}
            trailing={c.pending ? <Badge status="waiting" label="Needs you" /> : <Badge status="running" />}
            onClick={() => { send({ type: 'view', id: c.id }); showChat(); }} />
        ))}
      </div>
    </section>
  );
}
