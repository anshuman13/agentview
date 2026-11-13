import { Fragment, useEffect, useRef, useState } from 'react';
import { getState, notice, prompt, queueNext, send, useStore } from '../app/store';
import { Markdown } from '../chat/Chat';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Menu, MenuItem } from '../ui/Menu';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Skeleton } from '../ui/Skeleton';
import { ADVISORS, advisorOf, canBuildItem, memoryFacts, moveUpPrompt, rankPrompt, type Advisor, type AdvisorInfo, type BacklogItem } from '../../../shared/advisors';
import type { ClientMessage } from '../../../shared/protocol';
import { buildItemPrompt, buildSpecPrompt } from '../../../shared/specTasks';
import { StateDot } from './ChatRows';
import { chatState, since, useWorkspace } from './folders';
import { fetchAdvisors, fetchBacklog } from './sessionApi';

// Opens a chat and, on the phone layout, shows it.
const go = (m: ClientMessage) => {
  send(m);
  window.dispatchEvent(new Event('agentview:chat'));
};
const open = (a: Advisor, fresh = false) => go({ type: 'open_advisor', id: a.id, ...(fresh && { fresh }) });

// Opens the PM chat, then sends it a prompt once that chat is the one shown.
function askPm(text: string) {
  go({ type: 'open_advisor', id: 'pm' });
  const started = Date.now();
  const t = setInterval(() => {
    const { session } = getState();
    if (advisorOf(session.cwd)?.id === 'pm') {
      clearInterval(t);
      (session.running ? queueNext : prompt)(text, () => {});
    } else if (Date.now() - started > 15000) {
      clearInterval(t);
      notice('The PM chat did not open. The message was not sent.');
    }
  }, 150);
}

// The Build action of a backlog row: a new chat in the project that builds from the spec, or has the pm agent write it first.
const buildItem = (root: string, i: BacklogItem) => go({ type: 'new_session', cwd: root, text: i.spec ? buildSpecPrompt(`.claude/specs/${i.slug}.md`) : buildItemPrompt(i.title, i.why, i.slug) });

let chosenRoot: string | null = null;

// The PM's ranked backlog for one project, chosen from the repos; reloads after a PM turn, which may have rewritten it.
function Backlog({ shown, turns }: { shown: boolean; turns: string }) {
  const { folders } = useWorkspace('advisors');
  const [root, setRoot] = useState(chosenRoot);
  const [items, setItems] = useState<BacklogItem[] | null>(null);
  const [picking, setPicking] = useState(false);
  const pick = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!shown || !root) return;
    let stale = false;
    void fetchBacklog(root).then((x) => !stale && setItems(x));
    return () => { stale = true; };
  }, [shown, root, turns]);
  const choose = (cwd: string) => {
    chosenRoot = cwd;
    setRoot(cwd);
    setItems(null);
    setPicking(false);
  };
  return (
    <>
      <Section label="Backlog" count={items?.length || undefined} action={<Button ref={pick} size="sm" variant="quiet" onClick={() => setPicking(!picking)}>{root?.split('/').pop() ?? 'Project'}</Button>} />
      {!root ? (
        <div className="ui-group"><Row title="Project" meta="Pick one to see its backlog" trailing="Choose" onClick={() => setPicking(true)} /></div>
      ) : !items ? <Skeleton rows={2} /> : !items.length ? (
        <EmptyState size="sm" icon="list-ordered" title="No backlog yet" hint="The PM ranks what to build next" action={<Button size="sm" variant="tinted" onClick={() => askPm(rankPrompt(root))}>Ask PM to rank</Button>} />
      ) : (
        <div className="ui-group">
          {items.map((i) => (
            <Row
              key={i.rank}
              leading={i.rank}
              title={i.title}
              meta={`${i.status[0].toUpperCase()}${i.status.slice(1)} · ${i.why}`}
              plain
              menu={<>
                {canBuildItem(i) && <MenuItem icon="play" onClick={() => buildItem(root, i)}>Build</MenuItem>}
                <MenuItem icon="arrow-up" disabled={i.rank === 1} onClick={() => askPm(moveUpPrompt(root, i))}>Ask PM to move up</MenuItem>
              </>}
            />
          ))}
        </div>
      )}
      {picking && <Menu trigger={pick} onClose={() => setPicking(false)}>{folders.filter((f) => f.repo).map((f) => <MenuItem key={f.cwd} onClick={() => choose(f.cwd)}>{f.name}</MenuItem>)}</Menu>}
    </>
  );
}

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
            {a.id === 'pm' && <Backlog shown={shown} turns={turns} />}
          </Fragment>
        );
      })}
    </div></div></div>
  );
}
