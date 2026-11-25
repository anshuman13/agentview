import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cancelUnsent, forgetSeenBefore, getState, loadEarlier, queuedFor, seenBefore, send, setAtLatest, setUi, useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Button, Chip, IconButton, ShowToggle } from '../../ui/Button';
import { EmptyState } from '../../ui/Panel';
import { Markdown } from '../Chat';
import { BlockedCard } from '../cards/Pending';
import { ReviewCard } from '../cards/ReviewCard';
import { CopyPathItems } from '../../workspace/CopyPathItems';
import { FileIcon } from '../../workspace/FileIcon';
import { AlarmCard } from './AlarmCard';
import { SketchCard } from './SketchCard';
import { DocCard } from './DocCard';
import { SubChatRows } from './SubChatRows';
import { LinkAction, TranscriptBox } from './Box';
import { FindBar, findPending, markHit, takeFind, type FindRequest } from './FindBar';
import { showTurn, turnPending } from '../../sessions/openChat';
import { readBox, saveBox } from './boxOpen';
import { RewindLink } from './Rewind';
import { createFoldBuilder, openWork, proposalState, usedClaimState, type Claim, type FoldRow, type Proposal } from './workFold';
import { useAssistantTable } from '../../codex/data';
import { setView } from '../../codex/view';
import { MEMORY } from '../../codex/wiki/shared';
import { replaceTarget } from '../../../../shared/claimActions';
import { Badge } from '../../ui/Badge';
import { agentSummary } from '../../sessions/agents';
import { ALARM_TOOL, createTranscriptBuilder, denied, exploreLabel, exploreRuns, dayDividers, duration, newMarker, newReplies, openAtNew, rewindReplies, turnAnswers, firstLine, relPath, docCards, isDocFile, stepLabel, stepTone, type Item, type Rewind, type StepItem, type ToolResult, type ToolUse } from './steps';
import { clickOnKey, command, plural, pressable } from '../../ui/util';
import { useCan } from '../useCan';
import { copyPrompt, copyReply } from '../chatActions';
import { imageUrl } from '../chatApi';
import { MemoryPick } from '../cards/Memory';
import { failedLine, userParts } from '../composer/composerLogic';
import { billing, providerLabel } from '../../../../shared/providers';
import { isSketchPath } from '../../../../shared/sketches';
import { FIRST_ROWS, hiddenCount, needsEarlier, revealMore, stageRows, windowStart } from './window';
import { ROW_WINDOW, type ChatEvent } from '../../../../shared/protocol';
import { quoteText } from '../../../../shared/composerText';
import { useSelectionAt } from '../../ui/useSelectionAt';

export const Transcript = memo(function Transcript() {
  const events = useStore((s) => s.events);
  const cwd = useStore((s) => s.session.cwd);
  const running = useStore((s) => s.session.running);
  const chat = useStore((s) => s.session.id);
  const earlier = useStore((s) => s.earlier ?? 0);
  const provider = useStore((s) => s.session.provider);
  const failed = useStore((s) => !!s.live.find((c) => c.id === s.session.id)?.failed);
  const stalled = useStore((s) => !!s.live.find((c) => c.id === s.session.id)?.stalled);
  const sessionId = useStore((s) => s.session.sessionId);
  return <TranscriptView key={chat} sessionId={sessionId} events={events} earlier={earlier} cwd={cwd} running={running} bill={billing(provider)} failed={failed} stalled={stalled} label={providerLabel(provider)} />;
});

function EndLine({ text, label, onPress }: { text: string; label: string; onPress: () => void }) {
  const [sent, setSent] = useState(false);
  return <div className="tr-failed"><span className="tr-failed-text">{text}</span>{!sent && <Button size="sm" onClick={() => { setSent(true); onPress(); }}>{label}</Button>}</div>;
}

function UnsentRows() {
  const outbox = useStore((s) => s.outbox);
  const chat = useStore((s) => s.session.id);
  return <>{queuedFor(outbox, chat).map((q) => (
    <div key={q.id} className="tr-user unsent"><UserText id={q.id} text={q.text} /><span className="tr-stop"><Icon name="clock" small />Waiting to send<Button variant="plain" size="sm" onClick={() => cancelUnsent(q.id)}>Cancel</Button></span></div>
  ))}</>;
}

// The finished top-level reply a node lies in.
const replyOf = (rows: HTMLElement | null, node: Node | null) => {
  const reply = (node instanceof Element ? node : node?.parentElement)?.closest('.tr-assistant');
  return reply && reply.parentElement === rows && !reply.classList.contains('streaming') ? reply : null;
};

function QuoteButton({ rows }: { rows: RefObject<HTMLDivElement | null> }) {
  const { at, clear } = useSelectionAt(rows, rows, 100, (sel) => {
    const reply = replyOf(rows.current, sel.anchorNode);
    return !!reply && reply === replyOf(rows.current, sel.focusNode);
  });
  if (!at) return null;
  const quote = () => {
    window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: quoteText(at.quote) } }));
    document.getSelection()?.removeAllRanges();
    clear();
  };
  return <Button size="sm" variant="filled" icon="quote" className="tr-quote" style={{ left: at.x, top: at.top }} onMouseDown={(e) => e.preventDefault()} onClick={quote}>Quote</Button>;
}

function lastUserId(items: Item[]) {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'user') return items[i].id;
  return '';
}

function useSeenMark() {
  const seenTimes = useStore((s) => s.seen);
  const [mark, setMark] = useState(() => ({ seen: -1, openedAt: Date.now() }));
  // After a reload the seen times arrive after mount, so the mark waits for them.
  useEffect(() => {
    const id = getState().session.sessionId;
    if (mark.seen >= 0 || !id || seenBefore(id) < 0) return;
    setMark({ ...mark, seen: seenBefore(id) });
    forgetSeenBefore(id);
  }, [seenTimes, mark]);
  return mark;
}

// Follows the bottom of the rows while the reader stays there, and tracks how far behind they are when they scroll up.
function useStickyScroll(items: Item[], last: ChatEvent | undefined, running: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const size = useRef('');
  const lastUser = useRef('');
  const [stuck, setStuck] = useState(true);
  const [behind, setBehind] = useState(false);
  const [leftAt, setLeftAt] = useState('');
  const pin = useRef(false);

  const lineTop = () => {
    const el = box.current;
    const line = el?.querySelector<HTMLElement>('.tr-new');
    return el && line ? line.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : null;
  };

  // Puts the New line at the top; true when that moved the scroll.
  const place = () => {
    const el = box.current;
    const top = lineTop();
    if (!el || top === null || el.scrollTop === top) return false;
    const before = el.scrollTop;
    el.scrollTop = top;
    if (el.scrollTop === before) return false;
    size.current = '';
    return true;
  };

  // Opens at the New line, and keeps it there while rows above finish rendering, until the reader scrolls. New content that fits on screen leaves the chat at its end.
  const openAtLine = () => {
    const el = box.current;
    const top = lineTop();
    if (!el || top === null || top >= el.scrollHeight - el.clientHeight) return;
    lastUser.current = lastUserId(items);
    stick.current = false;
    pin.current = true;
    setStuck(false);
    setBehind(true);
    place();
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const mine = lastUserId(items);
    if (mine !== lastUser.current) {
      lastUser.current = mine;
      if (mine) { stick.current = true; pin.current = false; setStuck(true); }
    }
    if (stick.current) { el.scrollTop = el.scrollHeight; setBehind(false); }
    else setBehind(true);
  }, [items.length, last, running]);

  // Rows grow after they render (Markdown loads late, images decode), so a chat that sticks to the bottom follows them.
  useEffect(() => {
    const el = box.current;
    if (!el || !rows.current) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
      // A scroll event for the move still comes, and it must not read as the reader's.
      if (!(pin.current && place())) size.current = `${el.scrollHeight},${el.clientHeight}`;
    });
    ro.observe(el);
    ro.observe(rows.current);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    // The browser scrolls on its own when the content or box changes size; only a scroll at a steady size is the user's.
    const now = `${el.scrollHeight},${el.clientHeight}`;
    if (now !== size.current) { size.current = now; return; }
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pin.current = false;
    if (stick.current && !near) setLeftAt(items[items.length - 1]?.id ?? '');
    stick.current = near;
    setStuck(near);
    if (near) setBehind(false);
  };

  const jump = () => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stick.current = true;
    pin.current = false;
    setStuck(true);
    setBehind(false);
  };

  return { box, rows, stick, stuck, behind, leftAt, onScroll, jump, openAtLine };
}

// How many rows are shown, staged in over idle time, and loaded from earlier history on request.
function useRowWindow(count: number, replies: number, earlier: number, box: RefObject<HTMLDivElement | null>, stick: RefObject<boolean>) {
  const [shown, setShown] = useState(ROW_WINDOW);
  const [staged, setStaged] = useState(FIRST_ROWS);
  const grew = useRef(0);
  const [loading, setLoading] = useState(false);
  const start = windowStart(count, shown);
  const from = windowStart(count, Math.min(staged, shown));
  const staging = staged < Math.min(shown, count);

  useLayoutEffect(() => {
    const el = box.current;
    const delta = el ? el.scrollHeight - grew.current : 0;
    if (el && grew.current && delta) {
      el.scrollTop += delta;
      grew.current = 0;
    }
  }, [shown, staged, count]);

  useEffect(() => {
    if (!staging) return;
    const step = () => {
      if (!stick.current) grew.current = box.current?.scrollHeight ?? 0;
      setStaged(stageRows(staged, shown));
    };
    if (typeof requestIdleCallback === 'function') {
      const h = requestIdleCallback(step, { timeout: 200 });
      return () => cancelIdleCallback(h);
    }
    const h = setTimeout(step, 50);
    return () => clearTimeout(h);
  }, [staging, staged, shown]);

  const showEarlier = async (auto = false) => {
    if (loading) return false;
    // A page loaded by itself leaves a reader at the bottom there.
    const mark = () => { if (!(auto && stick.current)) grew.current = box.current?.scrollHeight ?? 0; };
    if (start > 0) {
      mark();
      const next = revealMore(shown, count);
      setShown(next);
      setStaged(next);
      return true;
    }
    setLoading(true);
    const ok = await loadEarlier();
    setLoading(false);
    // Marked only now: rows streamed in at the bottom during the load would otherwise spend the mark.
    if (ok) { mark(); setShown(shown + ROW_WINDOW); setStaged(shown + ROW_WINDOW); }
    return ok;
  };

  const autoLoads = useRef({ n: 0, failed: false });
  useEffect(() => {
    if (loading || autoLoads.current.failed || !needsEarlier(replies, earlier, autoLoads.current.n)) return;
    autoLoads.current.n++;
    showEarlier(true).then((ok) => { if (!ok) autoLoads.current.failed = true; });
  }, [replies, earlier, loading]);

  // Widens the window to the last `rows` rows.
  const reveal = (rows: number) => {
    if (rows <= Math.min(staged, shown)) return;
    const next = Math.max(shown, rows);
    setShown(next);
    setStaged(next);
  };

  return { shown, start, from, staging, loading, showEarlier, reveal };
}

function TranscriptView({ sessionId, events, earlier, cwd, running, bill, failed, stalled, label }: { sessionId: string | null; events: ChatEvent[]; earlier: number; cwd: string; running: boolean; bill: string; failed: boolean; stalled: boolean; label: string }) {
  const [build] = useState(createTranscriptBuilder);
  const items = useMemo(() => build(events), [build, events]);
  const last = events[events.length - 1];
  const scroll = useStickyScroll(items, last, running);
  const { box, rows, stuck, behind, onScroll, jump } = scroll;
  const canRewind = useCan('rewind');
  const rewinds = useMemo(() => rewindReplies(items), [items]);
  const answers = useMemo(() => turnAnswers(items, running), [items, running]);
  const replyCount = useMemo(() => items.filter((it) => it.kind === 'assistant').length, [items]);
  const cards = useMemo(() => docCards(items), [items]);
  const [fold] = useState(createFoldBuilder);
  const list = useMemo<FoldRow[]>(() => fold(items, events, cards).filter((r) => r.kind === 'item' || r.steps.length > 0 || r.work.tools > 0), [fold, items, events, cards]);
  const { shown, start, from, staging, loading, showEarlier, reveal } = useRowWindow(list.length, replyCount, earlier, box, scroll.stick);
  const [finding, setFinding] = useState(false);
  useEffect(() => {
    setAtLatest(stuck && !finding);
    return () => setAtLatest(false);
  }, [stuck, finding]);
  // n remounts the bar when a message hit arrives while it is open.
  const [begun, setBegun] = useState<{ n: number; request: FindRequest | null }>({ n: 0, request: null });
  const chatId = useRef(sessionId);
  chatId.current = sessionId;
  const begin = () => {
    const request = takeFind(chatId.current);
    if (request) setBegun((b) => ({ n: b.n + 1, request }));
    return request;
  };
  useEffect(() => {
    if (begin()) setFinding(true);
    const open = () => { begin(); setFinding(true); document.querySelector<HTMLInputElement>('.tr-find input')?.focus(); };
    window.addEventListener('agentview:find', open);
    return () => window.removeEventListener('agentview:find', open);
  }, []);
  const rowAt = (id: string) => list.findIndex((r) => (r.kind === 'item' ? r.it.id === id : r.hidden.some((h) => h.id === id)));
  const goToHit = (id: string) => {
    let at = rowAt(id);
    if (at < 0) {
      const prompt = events.slice(0, events.findIndex((e) => e.id === id) + 1).reverse().find((e) => e.kind === 'user');
      at = prompt ? rowAt(prompt.id) : -1;
    }
    if (at < 0) return () => {};
    const r = list[at];
    scroll.stick.current = false;
    reveal(list.length - at);
    return showTurn(r.kind === 'item' ? r.it.id : `work:${r.id}`, markHit);
  };
  const goTo = useRef(goToHit);
  goTo.current = goToHit;
  useEffect(() => {
    const show = (e: Event) => goTo.current((e as CustomEvent<{ id: string }>).detail.id);
    window.addEventListener('agentview:show-prompt', show);
    return () => window.removeEventListener('agentview:show-prompt', show);
  }, []);
  const runs = useMemo(() => exploreRuns(items), [items]);
  const mark = useSeenMark();
  const days = useMemo(() => dayDividers(items, Date.now()), [items]);
  const newId = useMemo(() => (mark.seen > 0 ? newMarker(items, new Map(events.map((e) => [e.id, e.at])), mark.seen, mark.openedAt) : null), [mark, events.length]);
  const newRow = useMemo(() => list.find((r) => (r.kind === 'item' ? r.it.id === newId : r.hidden.some((h) => h.id === newId))), [list, newId]);
  const openId = useMemo(() => openAtNew(items, newId), [items, newId]);
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (opened.current || !list.length) return;
    if (!openId || !newRow || finding || findPending(sessionId) || turnPending() || !scroll.stick.current) { opened.current = true; return; }
    const at = list.indexOf(newRow);
    if (at < from) { reveal(list.length - at); return; }
    opened.current = true;
    scroll.openAtLine();
  }, [openId, newRow, from, finding, list.length]);
  const folded = useMemo(() => new Set([...runs].flatMap(([, r]) => r.slice(1).map((s) => s.id))), [runs]);
  const replies = stuck ? 0 : newReplies(items, scroll.leftAt);
  const jumpLabel = `Jump to latest${replies > 0 ? ` · ${replies} new ${replies === 1 ? 'reply' : 'replies'}` : ''}`;
  const failText = failed && !running ? failedLine(events, label) : null;

  const rowOf = (it: Item, first: boolean) => {
    if (!first && folded.has(it.id)) return null;
    const run = runs.get(it.id);
    if (run) return <Explored key={it.id} id={it.id} run={run} cwd={cwd} />;
    return <Row key={it.id} it={it} cwd={cwd} settled={!running} card={cards.has(it.id)} answer={answers.has(it.id)} rewind={canRewind && !running ? rewinds.get(it.id) : undefined} />;
  };

  return (
    <div className="tr-host">
    {finding && <FindBar key={begun.n} events={events} earlier={earlier} start={begun.request} go={goToHit} onClose={() => setFinding(false)} />}
    <div ref={box} className="tr" onScroll={onScroll}>
      <div ref={rows} className="tr-rows">
      <SubChatRows sessionId={sessionId} cwd={cwd} />
      {items.length === 0 && <EmptyState size="sm" icon="comment-discussion" title="No messages yet" hint="Your prompts, the agent's steps and replies show up here" />}
      {!staging && (start > 0 || earlier > 0) && <div className="tr-more" {...pressable(() => showEarlier())}>{loading ? <><Icon name="loading" small spin /> Loading earlier…</> : `Show earlier (${hiddenCount(earlier, list.length, shown)} hidden)`}</div>}
      {list.slice(from).map((r, i) => {
        const id = r.kind === 'item' ? r.it.id : `work:${r.id}`;
        const day = r.kind === 'item' ? days.get(r.it.id) : undefined;
        const row = r.kind === 'fold'
          ? <Tasks key={id} row={r} live={running && r.last} />
          : rowOf(r.it, i === 0);
        return day || r === newRow ? <Fragment key={id}>{day && <div className="tr-day"><span>{day}</span></div>}{r === newRow && <div className="tr-new"><span>New</span></div>}{row}</Fragment> : row;
      })}
      {failText && <EndLine key={events.length} text={failText} label="Retry" onPress={() => send({ type: 'retry' })} />}
      {stalled && !failed && <EndLine text="No activity for 15 min" label="Resume" onPress={() => send({ type: 'steer', text: 'continue' })} />}
      <UnsentRows />
      <QuoteButton rows={rows} />
      </div>
    </div>
    {!stuck && (behind || running) && (
      <button className="tr-jump" aria-label={jumpLabel} title={jumpLabel} onClick={jump}>
        <Icon name="arrow-down" small /><span className="tr-jump-text">Jump to latest</span>
        {replies > 0 && <span className="badge quiet">{replies > 9 ? '9+' : replies}</span>}
      </button>
    )}
    </div>
  );
}

function sameItem(a: Item, b: Item): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind || a.id !== b.id) return false;
  switch (a.kind) {
    case 'file': {
      const o = b as typeof a;
      return a.path === o.path && a.error === o.error && a.pending === o.pending && a.count.add === o.count.add && a.count.del === o.count.del && a.uses.length === o.uses.length && a.uses.every((u, i) => u === o.uses[i]);
    }
    case 'step': {
      const o = b as typeof a;
      return a.use === o.use && a.result === o.result;
    }
    case 'agent': {
      const o = b as typeof a;
      return a.use === o.use && a.result === o.result && a.running === o.running && a.progress === o.progress && a.steps.length === o.steps.length && a.steps.every((s, i) => sameItem(s, o.steps[i]));
    }
    case 'blocked':
    case 'review':
      return a.ev === (b as typeof a).ev;
    default: {
      const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
      const keys = Object.keys(x);
      return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
    }
  }
}

export const Row = memo(RowImpl, (p, n) => p.cwd === n.cwd && p.settled === n.settled && p.card === n.card && p.answer === n.answer && p.rewind?.id === n.rewind?.id && p.readOnly === n.readOnly && sameItem(p.it, n.it));

const FOLD_LINES = 6;

// Text clamped at FOLD_LINES with Show more on overflow; the open state is kept under `id`.
function Folded({ id, className, children }: { id: string; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(() => readBox(id, false));
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setLong(el.scrollHeight > FOLD_LINES * parseFloat(getComputedStyle(el).lineHeight) + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);
  const toggle = () => { saveBox(id, !open); setOpen(!open); };
  return (
    <>
      <div ref={ref} className={`${className}${open ? '' : ' folded'}`}>{children}</div>
      {long && <ShowToggle open={open} onClick={toggle} />}
    </>
  );
}

export function UserImage({ path }: { path: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      {!loaded && <span className="tr-image-tag">Image: {path.split('/').pop()}</span>}
      {!failed && <img className="tr-image" hidden={!loaded} src={imageUrl(path)} alt={path} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    </>
  );
}

function UserText({ id, text }: { id: string; text: string }) {
  const parts = useMemo(() => userParts(text), [text]);
  return (
    <Folded id={'prompt-' + id} className="tr-user-text">
      {parts.map((p, i) => ('image' in p ? <UserImage key={i} path={p.image} /> : <div key={i}>{p.text}</div>))}
    </Folded>
  );
}

// A turn's tasks as small lines, and on the right a button that opens the turn's tool calls in their own tab.
// A finished turn shows only the tasks it marked done: the steps it never reached are no longer next.
const Tasks = memo(function Tasks({ row: { id, steps: all, now, work, claims, proposed, remembered }, live }: { row: Extract<FoldRow, { kind: 'fold' }>; live: boolean }) {
  const tools = work.tools;
  const [reading, setReading] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [memory, setMemory] = useState(false);
  const cwd = useStore((s) => s.session.cwd);
  const steps = live ? all : all.filter((s) => s.done);
  const done = steps.filter((s) => s.done).length;
  const current = live ? steps.find((s) => !s.done) : undefined;
  const spin = <span className="tr-dots" aria-hidden="true"><i /><i /></span>;
  return (
    <div id={`turn-work:${id}`} className="tr-steps">
      <div className="tr-steps-head">
        {steps.length > 0 && <span>{done < steps.length ? `Tasks \u00b7 ${done} of ${steps.length}` : plural(steps.length, 'task')}</span>}
        {claims.length > 0 && <Chip size="sm" on={reading} className="tr-claims-chip" aria-expanded={reading} onClick={() => setReading((v) => !v)}>{`Used ${plural(claims.length, 'claim')}`}</Chip>}
        {proposed.length > 0 && <Chip size="sm" on={proposing} className="tr-claims-chip" aria-expanded={proposing} onClick={() => setProposing((v) => !v)}>{`Proposed ${plural(proposed.length, 'claim')}`}</Chip>}
        {remembered.length > 0 && <Chip size="sm" className="tr-claims-chip" onClick={() => setMemory(true)}>{`Remembered ${plural(remembered.length, 'memory', 'memories')}`}</Chip>}
        {tools > 0 && <button type="button" className="tr-tools" title="Open this turn's tool calls in a tab" onClick={() => openWork(id)}>{`Used ${plural(tools, 'tool')}`}<Icon name="chevron-right" small /></button>}
      </div>
      {reading && <UsedClaims claims={claims} />}
      {proposing && <ProposedClaims proposed={proposed} />}
      {memory && <MemoryPick cwd={cwd} initial={remembered.length === 1 ? remembered[0] : undefined} onClose={() => setMemory(false)} />}
      {steps.length > 0 && <ul className="tr-tasks">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? 'done' : s === current ? 'now' : undefined}>
            {s.done ? <Icon name="check" small /> : s === current ? spin : <Icon name="circle-large-outline" small />}
            <span>{s === current && now ? now : s.title}</span>
          </li>
        ))}
        {live && !current && now && <li className="now">{spin}<span>{now}</span></li>}
      </ul>}
    </div>
  );
});

// The claims a turn read, each with what became of it; a claim that is not Gone opens on its wiki page, a replaced one at the end of its chain.
function UsedClaims({ claims }: { claims: Claim[] }) {
  const facts = useAssistantTable('facts');
  return (
    <ul className="tr-claims">
      {claims.map((c) => {
        const state = usedClaimState(facts, c.id);
        const note = [c.where, state].filter(Boolean).join(' · ');
        const open = state === 'Gone' ? undefined : pressable(() => {
          const own = facts.find((f) => f.id === c.id)!;
          const id = state === 'Replaced' ? replaceTarget(facts, c.id, own.profile) ?? c.id : c.id;
          setView({ list: 'wiki', open: facts.find((f) => f.id === id)?.page_id ?? MEMORY, anchor: id, person: null });
          command('assistant');
        });
        return <li key={c.id} {...open}>{c.text}{note && <span className="tr-claim-where"> ({note})</span>}</li>;
      })}
    </ul>
  );
}

// The claims a turn proposed, each with its state in the hub mirror, and a way to Review while one waits.
function ProposedClaims({ proposed }: { proposed: Proposal[] }) {
  const facts = useAssistantTable('facts');
  const states = proposed.map((p) => proposalState(facts.find((f) => f.id === p.id)));
  return (
    <>
      <ul className="tr-claims">{proposed.map((p, i) => <li key={p.id}>{p.text} <span className="tr-claim-where">({states[i]})</span></li>)}</ul>
      {states.includes('Waiting') && <Button variant="plain" size="sm" className="tr-review" onClick={() => { setView({ list: 'wiki', open: 'review', anchor: null, person: null }); command('assistant'); }}>Review</Button>}
    </>
  );
}

function RowImpl({ it, cwd, settled, card, answer, rewind, readOnly }: { it: Item; cwd: string; settled?: boolean; card?: boolean; answer?: boolean; rewind?: Rewind; readOnly?: boolean }) {
  const label = useStore((s) => providerLabel(s.session.provider));
  switch (it.kind) {
    case 'user':
      return <div id={`turn-${it.id}`} className={`tr-user ${it.stopping ? 'stopping' : ''} ${it.queued ? 'queued' : ''}`}>{it.voice && <span className="tr-mic" title="Spoken"><Icon name="mic" small /></span>}<UserText id={it.id} text={it.text} />{it.stopping && <span className="tr-stop"><Icon name="loading" small spin />{`Stopping ${label} to send this`}</span>}{it.queued && <span className="tr-stop"><Icon name="clock" small />{`Waiting for ${label}'s next step`}<Button variant="plain" size="sm" className="tl-send-now" title={`Stop ${label}'s current step and send this now`} onClick={() => send({ type: 'send_now', id: it.id })}>Send now</Button></span>}{!it.stopping && !it.queued && !readOnly && <span className="tr-acts"><IconButton icon="reply" label="Use again" onClick={() => window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: it.text } }))} /><IconButton icon="copy" label="Copy" onClick={() => copyPrompt(it.text)} /></span>}</div>;
    case 'assistant':
      return <div id={`turn-${it.id}`} className={`tr-assistant ${it.streaming ? 'streaming' : ''}`}><Markdown text={it.text} id={it.streaming ? undefined : it.id} />{!it.streaming && (answer || rewind) && <div className="tr-acts">{answer && <IconButton icon="copy" label="Copy" onClick={() => copyReply(it.text.trim())} />}{rewind && <RewindLink rewind={rewind} />}</div>}</div>;
    case 'system':
      return <div className={`tr-system${it.error ? ' err' : ''}`}>{it.text}</div>;
    case 'step':
      if (it.use.name === ALARM_TOOL) return <AlarmCard use={it.use} result={it.result} running={!settled} />;
      return <Step use={it.use} result={it.result} cwd={cwd} settled={settled} />;
    case 'file':
      if (isSketchPath(it.path) && !it.error) return <SketchCard path={it.path} meta={fileMeta(it, 'Sketch')} />;
      if (card && isDocFile(it.path) && !it.error) return <DocCard it={it} cwd={cwd} />;
      return <FileCard it={it} cwd={cwd} />;
    case 'agent':
      return <AgentRow it={it} cwd={cwd} />;
    case 'blocked':
      return <BlockedCard ev={it.ev} />;
    case 'review':
      return <ReviewCard ev={it.ev} />;
  }
}

export function Explored({ id, run, cwd }: { id: string; run: StepItem[]; cwd: string }) {
  return (
    <TranscriptBox id={`explore:${id}`} title={`Explored ${exploreLabel(run)}`}>
      <div className="tr-explored">{run.map((s) => <Row key={s.id} it={s} cwd={cwd} />)}</div>
    </TranscriptBox>
  );
}

const STEP_ICONS = { read: 'eye', edit: 'edit', run: 'terminal', web: 'globe', mcp: 'plug', agent: 'sparkle', other: 'tools' } as const;

function Step({ use, result, cwd, settled }: { use: ToolUse; result?: ToolResult; cwd: string; settled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { verb, object, mono, cmd } = stepLabel(use.name, use.input, cwd);
  const state = !result ? (settled ? 'idle' : 'pending') : denied(result) ? 'denied' : result.isError ? 'err' : 'ok';
  const dur = result ? duration(result.at - use.at) : '';
  const tone = stepTone(use.name);
  return (
    <div className={`tr-step tr-act t-${tone} ${state} ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)}>
      <span className="tr-mark">{state === 'pending' ? <Icon name="loading" small spin /> : <Icon name={STEP_ICONS[tone]} small />}</span>
      <span className="tr-text" title={object} role="button" tabIndex={0} aria-expanded={open} onKeyDown={clickOnKey}>{verb && <span className="tr-verb">{verb} </span>}<span className={`tr-obj ${mono ? 'mono' : ''}`}>{object}</span></span>
      <span className="tr-dur">{dur}</span>
      <span className="tr-chev"><Icon name={open ? 'chevron-down' : 'chevron-right'} small /></span>
      {cmd && !open && <span className="tr-cmd" title={cmd}>$ {cmd.replace(/\s*\n\s*/g, ' ⏎ ')}</span>}
      {state === 'err' && !open && <span className="tr-err">{firstLine(result!.text) || 'Failed'}</span>}
      {state === 'denied' && !open && <span className="tr-err">Denied</span>}
      {open && <Detail use={use} result={result} />}
    </div>
  );
}

function Detail({ use, result }: { use: ToolUse; result?: ToolResult }) {
  const input = typeof use.input.command === 'string' ? use.input.command : JSON.stringify(use.input, null, 2);
  return (
    <div className="tr-detail" onClick={(e) => e.stopPropagation()}>
      <pre>{input}</pre>
      {result && <pre className={result.isError && !denied(result) ? 'err' : ''}>{result.text || '(no output)'}</pre>}
    </div>
  );
}

const fileMeta = (it: Extract<Item, { kind: 'file' }>, noun: string) => (it.uses[0].name === 'Write' ? `${noun} written` : `${noun} edited · +${it.count.add} -${it.count.del}`);

function FileCard({ it, cwd }: { it: Extract<Item, { kind: 'file' }>; cwd: string }) {
  const rel = relPath(it.path, cwd);
  const cut = rel.lastIndexOf('/');
  const name = rel.slice(cut + 1);
  const open = () => setUi({ openFile: rel, follow: false });
  return (
    <TranscriptBox
      id={`file:${it.id}`}
      className={it.denied ? 'denied' : it.error ? 'err' : undefined}
      icon={<FileIcon name={name} />}
      title={name}
      meta={it.error ? <span className="tr-err">{it.error}</span> : <>{cut >= 0 && <span className="tr-dir">{rel.slice(0, cut + 1)} </span>}<span className="tr-count"><span className="add">+{it.count.add}</span> <span className="del">-{it.count.del}</span></span></>}
      action={<LinkAction label="Open" onClick={open} />}
      onOpen={open}
      menu={<CopyPathItems path={it.path} cwd={cwd} />}
    />
  );
}

function AgentRow({ it, cwd }: { it: Extract<Item, { kind: 'agent' }>; cwd: string }) {
  const { use, result, steps, running } = it;
  const canStop = useCan('stopTask');
  const desc = typeof use.input.description === 'string' && use.input.description ? use.input.description : 'Sub-agent';
  const type = typeof use.input.subagent_type === 'string' ? use.input.subagent_type : '';
  const dur = result && !running ? duration(result.at - use.at) : '';
  const badge = running ? <Badge status="running" /> : result?.stopped ? <Badge status="skipped" reason="Stopped" /> : denied(result) ? <Badge status="skipped" reason="Denied" /> : result?.isError ? <Badge status="failed" /> : <Badge status="done" />;
  return (
    <TranscriptBox
      id={`agent:${use.id}`}
      className={running ? 'running' : undefined}
      title={desc}
      meta={[type, dur, steps.length > 0 && plural(steps.length, 'step')].filter(Boolean).join(' · ')}
      state={badge}
      icon={<Icon name="sparkle" />}
      action={running && canStop ? <LinkAction label="Stop" title="Stop this agent" onClick={() => send({ type: 'stop_task', toolUseId: use.id })} /> : undefined}
      summary={agentSummary(it)}
    >
      {steps.length > 0 && <div className="tr-sub">{steps.map((s) => <Row key={s.id} it={s} cwd={cwd} settled={!running} />)}</div>}
      {result && !running && <div className="tr-report"><Markdown text={result.text || '(no output)'} id={it.id} /></div>}
    </TranscriptBox>
  );
}
