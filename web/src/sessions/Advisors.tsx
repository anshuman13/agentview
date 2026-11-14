import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { openSpecSheet } from '../app/deepLinks';
import { notice, useStore } from '../app/store';
import { Markdown } from '../chat/Chat';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Menu, MenuItem } from '../ui/Menu';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { ADVISORS, ADVISOR_LOOP_BUILDS, ADVISOR_LOOP_EVERY, advisorLoopBuilds, advisorLoopCommand, advisorLoopLine, advisorLoopOf, advisorNeedsYou, advisorOf, auditCountLine, auditPrompt, canBuildItem, defaultAdvisorRoot, memoryFacts, rankPrompt, specsFromAuditPrompt, type Advisor, type AdvisorInfo, type BacklogItem } from '../../../shared/advisors';
import { pipelineLabel, specRowParts, specHomeOrder, type SpecHomeItem } from '../../../shared/builds';
import type { ChatRun } from '../../../shared/protocol';
import { span } from '../../../shared/util';
import { OUTCOME_DOT } from '../chat/composer/composerLogic';
import { holdBadge } from './buildsLogic';
import { openRun } from './goalLogic';
import { buildItemPrompt, buildSpecPrompt, sketchSpecPrompt } from '../../../shared/specTasks';
import { askAdvisor, go } from './advisorChat';
import { StateDot } from './ChatRows';
import { chatState, repoRootOf, since, useWorkspace, type Folder } from './folders';
import { fetchAdvisors, fetchAudit, fetchBacklog, fetchSpecs, moveBacklogItem } from './sessionApi';

const open = (a: Advisor, fresh = false) => go({ type: 'open_advisor', id: a.id, ...(fresh && { fresh }) });

// The Build action of a backlog row: a new chat in the project that builds from the spec, or has the pm agent write it first.
const buildSpec = (root: string, slug: string) => go({ type: 'new_session', cwd: root, text: buildSpecPrompt(`.claude/specs/${slug}.md`) });
const sketchSpec = (root: string, slug: string) => go({ type: 'new_session', cwd: root, text: sketchSpecPrompt(`.claude/specs/${slug}.md`) });
const buildItem = (root: string, i: BacklogItem) => (i.spec ? buildSpec(root, i.slug) : go({ type: 'new_session', cwd: root, text: buildItemPrompt(i.title, i.why, i.slug) }));

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
  const [state, setState] = useState<{ root?: string | null; data?: T; failed?: boolean }>({});
  useEffect(() => {
    if (!shown || !root) return;
    let stale = false;
    fetcher(root).then((data) => !stale && setState({ root, data }), () => !stale && setState({ root, failed: true }));
    return () => { stale = true; };
  }, [fetcher, shown, root, turns]);
  return state.root === root ? state : {};
}

// The Advisor loop row of Backlog and Needs you: its last round, a tap opens its chat.
function LoopRow({ loop }: { loop: ChatRun }) {
  const last = loop.rounds.at(-1);
  const builds = advisorLoopBuilds(loop);
  return <Row title="Advisor loop" meta={advisorLoopLine(loop)} leading={last && <span className={`dot ${OUTCOME_DOT[last.outcome]}`} />} trailing={builds ? <span className="rn-cost">{builds}</span> : undefined} onClick={() => openRun(loop)} />;
}

// The Advisor loop row of Backlog when none runs: Start sends its goal to the PM chat, disabled for 10 s so a second tap cannot replace it.
function StartLoopRow({ root }: { root: string }) {
  const [sent, setSent] = useState(false);
  const start = () => {
    setSent(true);
    setTimeout(() => setSent(false), 10_000);
    askAdvisor('pm', advisorLoopCommand(root, Date.now()));
  };
  return <Row title="Advisor loop" meta={`Not running · every ${span(ADVISOR_LOOP_EVERY)} · up to ${ADVISOR_LOOP_BUILDS} builds`} plain action={<Button size="sm" variant="tinted" disabled={sent} onClick={start}>Start</Button>} />;
}

// The PM's ranked backlog for one project; reloads after a PM turn, which may have rewritten it.
function Backlog({ shown, turns, root, picker }: { shown: boolean; turns: string; root: string | null; picker: ReactNode }) {
  const fetched = useRootFetch(fetchBacklog, root, shown, turns).data;
  const [moved, setMoved] = useState<BacklogItem[] | null>(null);
  useEffect(() => setMoved(null), [fetched]);
  const items = moved ?? fetched;
  const runs = useStore((s) => s.runs);
  const loop = root ? advisorLoopOf(runs, root) : undefined;
  const [doneOpen, setDoneOpen] = useState(false);
  const todo = items?.filter((i) => i.status !== 'done');
  const done = items?.filter((i) => i.status === 'done');
  const move = (slug: string, dir: 'up' | 'down') => moveBacklogItem(root!, slug, dir).then((list) => (list ? setMoved(list) : notice('Could not move the item')));
  return (
    <>
      <Section label="Backlog" count={todo?.length || undefined} action={picker} />
      {root && <div className="ui-group">{loop ? <LoopRow loop={loop} /> : <StartLoopRow root={root} />}</div>}
      {!root ? (
        <div className="ui-group"><Row title="Project" meta="Pick one to see its backlog" plain /></div>
      ) : !items ? <Skeleton rows={2} /> : !items.length ? (
        <EmptyState size="sm" icon="list-ordered" title="No backlog yet" hint="The PM ranks what to build next" action={<Button size="sm" variant="tinted" onClick={() => askAdvisor('pm', rankPrompt(root))}>Ask PM to rank</Button>} />
      ) : !todo!.length ? (
        <EmptyState size="sm" icon="list-ordered" title="No open items" />
      ) : (
        <div className="ui-group">
          {todo!.map((i, n) => (
            <Row
              key={i.rank}
              leading={i.rank}
              title={i.title}
              meta={`${i.status[0].toUpperCase()}${i.status.slice(1)} · ${i.why}`}
              plain
              menu={<>
                {canBuildItem(i) && <MenuItem icon="play" onClick={() => buildItem(root, i)}>Build</MenuItem>}
                <MenuItem icon="arrow-up" disabled={n === 0} onClick={() => move(i.slug, 'up')}>Move up</MenuItem>
                <MenuItem icon="arrow-down" disabled={n === todo!.length - 1} onClick={() => move(i.slug, 'down')}>Move down</MenuItem>
              </>}
            />
          ))}
        </div>
      )}
      {root && !!done?.length && (
        <>
          <Section label="Done" count={done.length} open={doneOpen} onToggle={() => setDoneOpen(!doneOpen)} />
          {doneOpen && (
            <div className="ui-group">
              {done.map((i) => <Row key={i.rank} leading={i.rank} title={i.title} meta={`Done · ${i.why}`} plain />)}
            </div>
          )}
        </>
      )}
    </>
  );
}

const specBadge = (i: SpecHomeItem) =>
  i.waiting || i.hold || i.state === 'waiting' ? <Badge status={holdBadge.status} label={holdBadge.label} /> : i.state === 'running' || i.state === 'failed' ? <Badge status={i.state} /> : undefined;

// A spec row of Specs and Needs you: a tap opens the build chat, with its Spec sheet when that chat is live.
function SpecRow({ spec: i, root }: { spec: SpecHomeItem; root: string }) {
  const isLive = useStore((s) => s.live.some((c) => c.id === i.chat));
  const tappable = isLive || !!i.session;
  const openBuild = () => {
    if (isLive) {
      go({ type: 'view', id: i.chat! });
      openSpecSheet(i.chat!, i.slug);
    } else go({ type: 'open_session', sessionId: i.session! });
  };
  const { meta, when } = specRowParts(i, since);
  return (
    <Row
      title={i.title}
      meta={meta}
      state={specBadge(i)}
      trailing={when ? <span className="rn-cost">{when}</span> : undefined}
      plain={!tappable}
      onClick={tappable ? openBuild : undefined}
      menu={i.built ? undefined : (
        <>
          {!i.sketched && <MenuItem icon="paintcan" onClick={() => sketchSpec(root, i.slug)}>Sketch</MenuItem>}
          <MenuItem icon="play" onClick={() => buildSpec(root, i.slug)}>Build</MenuItem>
        </>
      )}
    />
  );
}

// The newest specs of one project, what needs you first.
function Specs({ specs, root }: { specs: SpecHomeItem[] | null | undefined; root: string | null }) {
  if (!root || !specs) return null;
  return (
    <>
      <Section label="Specs" count={specs.length || undefined} />
      {!specs.length ? <EmptyState size="sm" icon="file" title="No specs yet" /> : (
        <div className="ui-group">{specHomeOrder(specs).map((i) => <SpecRow key={i.slug} spec={i} root={root} />)}</div>
      )}
    </>
  );
}

// What waits on you in the chosen project: its Advisor loop when it asks, then the specs awaiting approval.
function NeedsYou({ specs, root }: { specs: SpecHomeItem[] | null | undefined; root: string | null }) {
  const runs = useStore((s) => s.runs);
  const items = root && specs ? advisorNeedsYou(specs, runs, root) : [];
  if (!root || !items.length) return null;
  return (
    <>
      <Section label="Needs you" count={items.length} />
      <div className="ui-group">{items.map((i) => (i.kind === 'loop' ? <LoopRow key="loop" loop={i.run} /> : <SpecRow key={i.spec.slug} spec={i.spec} root={root} />))}</div>
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
            meta={audit ? `${audit.date} · ${auditCountLine(audit.findings)}` : 'Not run yet'}
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
          {audit.findings.map((f) => <Row key={f.rank} leading={f.rank} title={f.screen} meta={`${f.status === 'fixed' ? 'Fixed · ' : ''}${f.severity[0].toUpperCase()}${f.severity.slice(1)} · ${f.problem}. ${f.fix}`} className="bd-clamp" plain />)}
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
  const openCwd = useStore((s) => s.session.cwd);
  const [info, setInfo] = useState<AdvisorInfo[] | null | undefined>(undefined);
  const [memory, setMemory] = useState<string | null>(null);
  const { folders } = useWorkspace('advisors');
  const [picked, setPicked] = useState(chosenRoot);
  const pickRoot = (cwd: string) => {
    chosenRoot = cwd;
    setPicked(cwd);
  };
  const root = picked ?? defaultAdvisorRoot(repoRootOf(openCwd) ?? null, folders.filter((f) => f.repo));
  const picker = <ProjectPicker root={root} folders={folders} onPick={pickRoot} />;
  // Reloads when the page shows and after an advisor's turn, which may have changed its memory.
  const turns = live.filter((c) => advisorOf(c.cwd) && !c.running).map((c) => `${c.id}:${c.lastActive}`).join();
  const specs = useRootFetch(fetchSpecs, root, shown, turns).data;
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
      <NeedsYou specs={specs} root={root} />
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
            {a.id === 'pm' && <><Backlog key={root} shown={shown} turns={turns} root={root} picker={picker} /><Specs specs={specs} root={root} /></>}
            {a.id === 'designer' && <AuditRow key={root} shown={shown} turns={turns} root={root} running={!!c?.running} picker={picker} />}
          </Fragment>
        );
      })}
    </div></div></div>
  );
}
