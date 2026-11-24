import { useMemo, useState } from 'react';
import { send, useStore } from '../../app/store';
import { countChat } from '../../app/shell/counts';
import { AGENT_GROUPS, agentGroup } from '../../../../shared/counts';
import { activity } from '../../../../shared/activity';
import { clock } from '../../../../shared/util';
import { Icon } from '../../ui/Icon';
import { chatLine } from '../../sessions/folders';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { showChat } from '../../ui/util';

// Live chats in Duet's groups: Needs input, Working and Ready for review, each row led by its colored status word.
export function RunningChats() {
  const live = useStore((s) => s.live);
  const seen = useStore((s) => s.seen);
  const viewing = useStore((s) => s.session.id);
  const groups = useMemo(() => {
    const rows = live.flatMap((c) => { const g = c.id === viewing ? null : agentGroup(countChat(c, seen)); return g ? [{ c, g }] : []; });
    return AGENT_GROUPS.map(([key, label]) => ({ key, label, rows: rows.filter((r) => r.g === key).map((r) => r.c) })).filter((g) => g.rows.length);
  }, [live, seen, viewing]);
  const [openDone, setOpenDone] = useState(false);
  const done = useMemo(() => {
    const skip = new Set([viewing, ...groups.flatMap((g) => g.rows.map((c) => c.id))]);
    return activity(live, skip, new Date().setHours(0, 0, 0, 0));
  }, [live, groups, viewing]);
  return (
    <>
      {groups.map((g) => (
        <section key={g.key}>
          <Section label={g.label} count={g.rows.length} />
          <div className="as-group">
            {g.rows.map((c) => (
              <Row key={c.id} title={c.title}
                meta={<><span className={`ov-word ${g.key}`}>{g.label}</span> · {g.key === 'input' ? 'Waiting for you' : chatLine(c, null).text || (g.key === 'working' ? 'Working' : 'Finished')} · {c.cwd.split('/').pop()}</>}
                onClick={() => { send({ type: 'view', id: c.id }); showChat(); }} />
            ))}
          </div>
        </section>
      ))}
      {done.length > 0 && (
        <div className="as-group">
          <Row title="Done today" meta={`${done.length} · last: ${done[0].title}`} lines={1} onClick={() => setOpenDone(!openDone)}
            trailing={<Icon name={openDone ? 'chevron-up' : 'chevron-down'} small />} />
          {openDone && done.map((a) => (
            <Row key={a.id} title={a.title} lines={1}
              leading={<Icon name={a.failed ? 'error' : 'pass'} color={a.failed ? 'var(--warn)' : 'var(--ok)'} />}
              meta={<>{a.line} · {clock(a.at)}</>}
              onClick={() => { send({ type: 'view', id: a.id }); showChat(); }} />
          ))}
        </div>
      )}
    </>
  );
}
