import { Fragment, useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { Markdown } from '../chat/Chat';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { ADVISORS, advisorOf, memoryFacts, type AdvisorInfo } from '../../../shared/advisors';
import { go, openAdvisor } from './advisorChat';
import { StateDot } from './ChatRows';
import { chatState, since } from './folders';
import { fetchAdvisors } from './sessionApi';

// PM, Architect and Designer, each with its current conversation, earlier ones and its memory; reloads after an advisor's turn, which may have changed its memory.
export function AdvisorsSheet({ turns, onClose }: { turns: string; onClose: () => void }) {
  const live = useStore((s) => s.live);
  const seen = useStore((s) => s.seen);
  const viewing = useStore((s) => s.session.id);
  const [info, setInfo] = useState<AdvisorInfo[] | null | undefined>(undefined);
  const [memory, setMemory] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    void fetchAdvisors().then((x) => !stale && setInfo(x));
    return () => { stale = true; };
  }, [turns]);
  return (
    <Sheet label="Conversations and memory" onClose={onClose} className="au-sheet">
      <h2>Conversations and memory</h2>
      {info === undefined ? <Skeleton rows={6} /> : !info ? <EmptyState size="sm" title="Could not load the advisors" /> : ADVISORS.map((a) => {
        const c = live.find((x) => advisorOf(x.cwd)?.id === a.id);
        const state = c && chatState({ live: c }, seen);
        const got = info.find((x) => x.id === a.id);
        const earlier = (got?.chats ?? []).filter((s) => s.sessionId !== c?.sessionId);
        const facts = memoryFacts(got?.memory ?? '');
        return (
          <Fragment key={a.id}>
            <Section label={a.name} count={a.model} action={<Button size="sm" variant="quiet" icon="add" onClick={() => openAdvisor(a, true)}>New conversation</Button>} />
            <div className="ui-group">
              <div className={state === 'done' || state === 'needs' ? 'chat-row unread' : 'chat-row'}>
                <Row
                  title={c?.title || `Talk to ${a.name}`}
                  meta={!c ? a.hint : c.pending ? 'Needs you' : c.running ? 'Working' : `Open · ${since(c.lastActive)}`}
                  leading={state ? <StateDot state={state} /> : undefined}
                  aria-current={c?.id === viewing || undefined}
                  onClick={() => (c ? go({ type: 'view', id: c.id }) : openAdvisor(a))}
                />
              </div>
              {earlier.map((s) => <Row key={s.sessionId} title={s.title || 'Untitled'} meta={since(s.lastModified)} onClick={() => go({ type: 'open_session', sessionId: s.sessionId })} />)}
              <Row title="Memory" meta={facts ? `${facts} ${facts === 1 ? 'fact' : 'facts'}` : 'Nothing yet'} plain={!facts} onClick={facts ? () => setMemory(memory === a.id ? null : a.id) : undefined} aria-expanded={facts ? memory === a.id : undefined} />
            </div>
            {memory === a.id && got && <div className="advisor-memory"><Markdown text={got.memory.replace(/^# .*\n/, '')} /></div>}
          </Fragment>
        );
      })}
    </Sheet>
  );
}
