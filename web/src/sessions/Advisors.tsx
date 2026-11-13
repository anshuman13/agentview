import { Fragment, useEffect, useState } from 'react';
import { send, useStore } from '../app/store';
import { Markdown } from '../chat/Chat';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Skeleton } from '../ui/Skeleton';
import { ADVISORS, advisorOf, memoryFacts, type Advisor, type AdvisorInfo } from '../../../shared/advisors';
import type { ClientMessage } from '../../../shared/protocol';
import { StateDot } from './ChatRows';
import { chatState, since } from './folders';
import { fetchAdvisors } from './sessionApi';

// Opens a chat and, on the phone layout, shows it.
const go = (m: ClientMessage) => {
  send(m);
  window.dispatchEvent(new Event('agentview:chat'));
};
const open = (a: Advisor, fresh = false) => go({ type: 'open_advisor', id: a.id, ...(fresh && { fresh }) });

// The Advisors page: PM, Architect and Designer, each with its current conversation, earlier ones and its memory.
export function Advisors({ shown }: { shown: boolean }) {
  const live = useStore((s) => s.live);
  const seen = useStore((s) => s.seen);
  const viewing = useStore((s) => s.session.id);
  const [info, setInfo] = useState<AdvisorInfo[] | null | undefined>(undefined);
  const [memory, setMemory] = useState<string | null>(null);
  // Reloads when the page shows and after an advisor's turn, which may have changed its memory.
  const turns = live.filter((c) => advisorOf(c.cwd) && !c.running).map((c) => `${c.id}:${c.lastActive}`).join();
  useEffect(() => {
    if (!shown) return;
    let stale = false;
    void fetchAdvisors().then((x) => !stale && setInfo(x));
    return () => { stale = true; };
  }, [shown, turns]);
  if (info === undefined) return <Skeleton rows={6} />;
  if (!info) return <EmptyState size="sm" title="Could not load the advisors" />;
  return (
    <div className="wk"><div className="wk-scroll"><div className="mt-page">
      {ADVISORS.map((a) => {
        const c = live.find((x) => advisorOf(x.cwd)?.id === a.id);
        const state = c && chatState({ live: c }, seen);
        const got = info.find((x) => x.id === a.id);
        const earlier = (got?.chats ?? []).filter((s) => s.sessionId !== c?.sessionId);
        const facts = memoryFacts(got?.memory ?? '');
        return (
          <Fragment key={a.id}>
            <Section label={a.name} count={a.model} action={<Button size="sm" variant="quiet" icon="add" onClick={() => open(a, true)}>New conversation</Button>} />
            <div className="ui-group">
              <div className={state === 'done' || state === 'needs' ? 'chat-row unread' : 'chat-row'}>
                <Row
                  title={c?.title || `Talk to ${a.name}`}
                  meta={!c ? a.hint : c.pending ? 'Needs you' : c.running ? 'Working' : `Open · ${since(c.lastActive)}`}
                  leading={state ? <StateDot state={state} /> : undefined}
                  aria-current={c?.id === viewing || undefined}
                  onClick={() => (c ? go({ type: 'view', id: c.id }) : open(a))}
                />
              </div>
              {earlier.map((s) => <Row key={s.sessionId} title={s.title || 'Untitled'} meta={since(s.lastModified)} onClick={() => go({ type: 'open_session', sessionId: s.sessionId })} />)}
              <Row title="Memory" meta={facts ? `${facts} ${facts === 1 ? 'fact' : 'facts'}` : 'Nothing yet'} plain={!facts} onClick={facts ? () => setMemory(memory === a.id ? null : a.id) : undefined} aria-expanded={facts ? memory === a.id : undefined} />
            </div>
            {memory === a.id && got && <div className="advisor-memory"><Markdown text={got.memory.replace(/^# .*\n/, '')} /></div>}
          </Fragment>
        );
      })}
    </div></div></div>
  );
}
