import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../app/store';
import { Markdown } from '../chat/Chat';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Menu, MenuItem } from '../ui/Menu';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { ADVISORS, advisorOf, auditPrompt, canBuildItem, memoryFacts, moveUpPrompt, rankPrompt, specsFromAuditPrompt, type Advisor, type AdvisorInfo, type BacklogItem } from '../../../shared/advisors';
import { buildItemPrompt, buildSpecPrompt } from '../../../shared/specTasks';
import { askAdvisor, go } from './advisorChat';
import { StateDot } from './ChatRows';
import { chatState, since, useWorkspace, type Folder } from './folders';
import { fetchAdvisors, fetchAudit, fetchBacklog } from './sessionApi';

const open = (a: Advisor, fresh = false) => go({ type: 'open_advisor', id: a.id, ...(fresh && { fresh }) });

// The Build action of a backlog row: a new chat in the project that builds from the spec, or has the pm agent write it first.
const buildItem = (root: string, i: BacklogItem) => go({ type: 'new_session', cwd: root, text: i.spec ? buildSpecPrompt(`.claude/specs/${i.slug}.md`) : buildItemPrompt(i.title, i.why, i.slug) });

let chosenRoot: string | null = null;

// The project the Backlog and Audit sections show, chosen from the repos.
function ProjectPicker({ root, folders, onPick }: { root: string | null; folders: Folder[]; onPick: (cwd: string) => void }) {
  const [picking, setPicking] = useState(false);
  const pick = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={pick} size="sm" variant="quiet" onClick={() => setPicking(!picking)}>{root?.split('/').pop() ?? 'Project'}</Button>
      {picking && <Menu trigger={pick} onClose={() => setPicking(false)}>{folders.filter((f) => f.repo).map((f) => <MenuItem key={f.cwd} onClick={() => { setPicking(false); onPick(f.cwd); }}>{f.name}</MenuItem>)}</Menu>}
    </>
  );
}

// Loads one project's data when the page shows and after an advisor's turn; failed is set when the request rejects.
function useRootFetch<T>(fetcher: (root: string) => Promise<T>, root: string | null, shown: boolean, turns: string) {
  const [state, setState] = useState<{ data?: T; failed?: boolean }>({});
  useEffect(() => {
    if (!shown || !root) return;
    let stale = false;
    fetcher(root).then((data) => !stale && setState({ data }), () => !stale && setState({ failed: true }));
    return () => { stale = true; };
  }, [fetcher, shown, root, turns]);
  return state;
}

// The PM's ranked backlog for one project; reloads after a PM turn, which may have rewritten it.
function Backlog({ shown, turns, root, picker }: { shown: boolean; turns: string; root: string | null; picker: ReactNode }) {
  const items = useRootFetch(fetchBacklog, root, shown, turns).data;
  return (
    <>
      <Section label="Backlog" count={items?.length || undefined} action={picker} />
      {!root ? (
        <div className="ui-group"><Row title="Project" meta="Pick one to see its backlog" plain /></div>
      ) : !items ? <Skeleton rows={2} /> : !items.length ? (
        <EmptyState size="sm" icon="list-ordered" title="No backlog yet" hint="The PM ranks what to build next" action={<Button size="sm" variant="tinted" onClick={() => askAdvisor('pm', rankPrompt(root))}>Ask PM to rank</Button>} />
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
                <MenuItem icon="arrow-up" disabled={i.rank === 1} onClick={() => askAdvisor('pm', moveUpPrompt(root, i))}>Ask PM to move up</MenuItem>
              </>}
            />
          ))}
        </div>
      )}
    </>
  );
}

// The Designer's newest usability audit for the chosen project: Run audit is in the menu, Specs from audit hands it to the PM.
function AuditRow({ shown, turns, root, running, picker }: { shown: boolean; turns: string; root: string | null; running: boolean; picker: ReactNode }) {
  const { data: audit, failed } = useRootFetch(fetchAudit, root, shown, turns);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Section label="Usability audit" action={picker} />
      {!root ? (
        <div className="ui-group"><Row title="Project" meta="Pick one to audit it" plain /></div>
      ) : failed ? (
        <div className="ui-group"><Row title="Audit" meta="Could not load the audit" plain /></div>
      ) : audit === undefined ? <Skeleton rows={1} /> : (
        <div className="ui-group">
          <Row
            title="Audit"
            meta={audit ? `${audit.date} · ${audit.findings.length} ${audit.findings.length === 1 ? 'finding' : 'findings'}` : 'Not run yet'}
            action={running ? <Badge status="running" /> : <Button size="sm" variant="tinted" disabled={!audit} onClick={() => askAdvisor('pm', specsFromAuditPrompt(root))}>Specs from audit</Button>}
            menu={<>
              <MenuItem icon="list-flat" disabled={!audit} onClick={() => setOpen(true)}>Open latest audit</MenuItem>
              <MenuItem icon="play" disabled={running} onClick={() => askAdvisor('designer', auditPrompt(root))}>Run audit</MenuItem>
            </>}
          />
        </div>
      )}
      {open && audit && (
        <Sheet label="Audit" onClose={() => setOpen(false)} className="au-sheet">
          <h2>Audit, {audit.date}</h2>
          {audit.findings.map((f) => <Row key={f.rank} leading={f.rank} title={f.screen} meta={`${f.severity[0].toUpperCase()}${f.severity.slice(1)} · ${f.problem}. ${f.fix}`} className="bd-clamp" plain />)}
        </Sheet>
      )}
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
  const { folders } = useWorkspace('advisors');
  const [root, setRoot] = useState(chosenRoot);
  const pickRoot = (cwd: string) => {
    chosenRoot = cwd;
    setRoot(cwd);
  };
  const picker = <ProjectPicker root={root} folders={folders} onPick={pickRoot} />;
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
            {a.id === 'pm' && <Backlog key={root} shown={shown} turns={turns} root={root} picker={picker} />}
            {a.id === 'designer' && <AuditRow key={root} shown={shown} turns={turns} root={root} running={!!c?.running} picker={picker} />}
          </Fragment>
        );
      })}
    </div></div></div>
  );
}
