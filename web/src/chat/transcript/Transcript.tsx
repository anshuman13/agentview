import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { forgetSeenBefore, getState, loadEarlier, notice, seenBefore, send, setUi, useStore } from '../../app/store';
import { assistantStore } from '../../codex/data';
import { quoteReply, replyNote } from '../composer/composerLogic';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/Button';
import { Row as ListRow } from '../../ui/Row';
import { SinceSheet } from './SinceSheet';
import { SummarySheet } from './SummarySheet';
import { replyOf, turnEvents, turnSummary } from './summary';
import { roundsSince } from './recap';
import { clock } from '../../codex/tasks/time';
import { Markdown } from '../Chat';
import { BlockedCard } from '../cards/Pending';
import { ReviewCard } from '../cards/ReviewCard';
import { FileIcon } from '../../workspace/FileIcon';
import { SpecCard, SpecRow } from './SpecCard';
import { TranscriptBox } from './Box';
import { Badge } from '../../ui/Badge';
import { agentSummary } from '../../sessions/agents';
import { agentBuild, createTranscriptBuilder, denied, exploreLabel, exploreRuns, dayDividers, duration, newMarker, newReplies, firstLine, relPath, specCards, stepLabel, stepTone, type Item, type StepItem, type ToolResult, type ToolUse } from './steps';
import { clickOnKey, copyText, plural, pressable } from '../../ui/util';
import { useCan } from '../useCan';
import { stageName } from '../../../../shared/builds';
import { providerLabel } from '../../../../shared/providers';
import { isSpecPath, specSlug } from '../../../../shared/specTasks';
import { FIRST_ROWS, hiddenCount, needsEarlier, revealMore, stageRows, windowStart } from './window';
import { ROW_WINDOW, type ChatEvent } from '../../../../shared/protocol';

export function Transcript() {
  const events = useStore((s) => s.events);
  const cwd = useStore((s) => s.session.cwd);
  const running = useStore((s) => s.session.running);
  const chat = useStore((s) => s.session.id);
  const earlier = useStore((s) => s.earlier ?? 0);
  return <TranscriptView key={chat} chat={chat} events={events} earlier={earlier} cwd={cwd} running={running} />;
}

function lastUserId(items: Item[]) {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'user') return items[i].id;
  return '';
}

function useSeenMark(events: ChatEvent[]) {
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

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const mine = lastUserId(items);
    if (mine !== lastUser.current) {
      lastUser.current = mine;
      if (mine) { stick.current = true; setStuck(true); }
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
      size.current = `${el.scrollHeight},${el.clientHeight}`;
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
    if (stick.current && !near) setLeftAt(items[items.length - 1]?.id ?? '');
    stick.current = near;
    setStuck(near);
    if (near) setBehind(false);
  };

  const jump = () => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stick.current = true;
    setStuck(true);
    setBehind(false);
  };

  return { box, rows, stick, stuck, behind, leftAt, onScroll, jump };
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

  return { shown, start, from, staging, loading, showEarlier };
}

function TranscriptView({ chat, events, earlier, cwd, running }: { chat: string; events: ChatEvent[]; earlier: number; cwd: string; running: boolean }) {
  const [build] = useState(createTranscriptBuilder);
  const items = useMemo(() => build(events), [build, events]);
  const last = events[events.length - 1];
  const scroll = useStickyScroll(items, last, running);
  const { box, rows, stuck, behind, onScroll, jump } = scroll;
  const replyCount = useMemo(() => items.filter((it) => it.kind === 'assistant').length, [items]);
  const { shown, start, from, staging, loading, showEarlier } = useRowWindow(items.length, replyCount, earlier, box, scroll.stick);
  const runs = useMemo(() => exploreRuns(items), [items]);
  const cards = useMemo(() => specCards(items), [items]);
  const mark = useSeenMark(events);
  const days = useMemo(() => dayDividers(items, Date.now()), [items]);
  const summaries = useMemo(() => new Map(turnEvents(events).flatMap((t) => { const reply = replyOf(t.events); return reply && !reply.streaming ? [[reply.id, t.events] as const] : []; })), [events]);
  const newId = useMemo(() => (mark.seen > 0 ? newMarker(items, new Map(events.map((e) => [e.id, e.at])), mark.seen, mark.openedAt) : null), [items, events, mark]);
  const recap = useStore((s) => s.live.find((c) => c.id === s.session.id)?.recap);
  const [since, setSince] = useState(true);
  const [sinceOpen, setSinceOpen] = useState(false);
  const run = useStore((s) => s.runs.filter((r) => r.chatId === s.session.id && r.state !== 'done').at(-1));
  const fresh = useMemo(() => roundsSince(run?.rounds ?? [], mark.seen), [run, mark.seen]);
  const folded = useMemo(() => new Set([...runs].flatMap(([, r]) => r.slice(1).map((s) => s.id))), [runs]);
  const replies = stuck ? 0 : newReplies(items, scroll.leftAt);

  return (
    <div className="tr-host">
    {newId && recap && since && <SinceBox chat={chat} recap={recap} at={fresh[0]?.at} onOpen={() => setSinceOpen(true)} onDismiss={() => setSince(false)} />}
    {sinceOpen && recap && <SinceSheet chat={chat} recap={recap} rounds={fresh} run={run} onClose={() => setSinceOpen(false)} />}
    <div ref={box} className="tr" onScroll={onScroll}>
      <div ref={rows} className="tr-rows">
      {items.length === 0 && <div className="tr-empty">No messages yet. Your prompts, the agent's steps and replies show up here.</div>}
      {!staging && (start > 0 || earlier > 0) && <div className="tr-more" {...pressable(() => showEarlier())}>{loading ? 'Loading earlier…' : `Show earlier (${hiddenCount(earlier, items.length, shown)} hidden)`}</div>}
      {items.slice(from).map((it, i) => {
        if (i > 0 && folded.has(it.id)) return null;
        const run = runs.get(it.id);
        if (run) return <Explored key={it.id} id={it.id} run={run} cwd={cwd} />;
        const row = <Row key={it.id} it={it} cwd={cwd} card={cards.has(it.id)} />;
        const day = days.get(it.id);
        const turn = summaries.get(it.id);
        return day || it.id === newId || turn ? <Fragment key={it.id}>{day && <div className="tr-day"><span>{day}</span></div>}{it.id === newId && <div className="tr-new"><span>New</span></div>}{row}{turn && <SummaryLink events={turn} />}</Fragment> : row;
      })}
      </div>
    </div>
    {!stuck && (behind || running) && <button className="tr-jump" onClick={jump}><Icon name="arrow-down" small />Jump to latest{replies > 0 && ` · ${replies} new ${replies === 1 ? 'reply' : 'replies'}`}</button>}
    </div>
  );
}

function SummaryLink({ events }: { events: ChatEvent[] }) {
  const [open, setOpen] = useState(false);
  if (turnSummary(events).length === 0) return null;
  return (
    <div className="tr-acts">
      <button className="link" aria-haspopup="dialog" onClick={() => setOpen(true)}>Summary</button>
      {open && <SummarySheet events={events} onClose={() => setOpen(false)} />}
    </div>
  );
}

function sameItem(a: Item, b: Item): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind || a.id !== b.id) return false;
  switch (a.kind) {
    case 'file': {
      const o = b as typeof a;
      return a.path === o.path && a.error === o.error && a.count.add === o.count.add && a.count.del === o.count.del && a.uses.length === o.uses.length && a.uses.every((u, i) => u === o.uses[i]);
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

export const Row = memo(RowImpl, (p, n) => p.cwd === n.cwd && p.settled === n.settled && p.card === n.card && sameItem(p.it, n.it));

function AutoRow({ it }: { it: Extract<Item, { kind: 'auto' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div id={`turn-${it.id}`} className="tr-auto" {...pressable(() => setOpen((v) => !v))} title={open ? 'Hide the prompt' : 'Show the full prompt'}>
      <Icon name={open ? 'chevron-down' : 'chevron-right'} small />{it.label}
      {open && <div className="tr-auto-text">{it.text}</div>}
    </div>
  );
}

function RowImpl({ it, cwd, settled, card }: { it: Item; cwd: string; settled?: boolean; card?: boolean }) {
  const label = useStore((s) => providerLabel(s.session.provider));
  switch (it.kind) {
    case 'user':
      return <div className={`tr-user ${it.stopping ? 'stopping' : ''} ${it.queued ? 'queued' : ''}`}>{it.text}{it.stopping && <span className="tr-stop"><Icon name="loading" small spin /></span>}{it.queued && <span className="tr-stop" title={`Waiting for ${label}'s next step`}><Icon name="clock" small /><button className="link tl-send-now" title={`Stop ${label}'s current step and send this now`} onClick={() => send({ type: 'send_now', id: it.id })}>Send now</button></span>}{!it.stopping && !it.queued && <span className="tr-acts"><button className="link" title="Put this prompt in the composer to edit and send again" onClick={() => window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: it.text } }))}>Use again</button></span>}</div>;
    case 'phase':
      return <div className="tr-phase"><Icon name="sync" small />{it.text}</div>;
    case 'auto':
      return <AutoRow it={it} />;
    case 'assistant':
      return <div className={`tr-assistant ${it.streaming ? 'streaming' : ''}`}><Markdown text={it.text} id={it.streaming ? undefined : it.id} />{!it.streaming && <div className="tr-acts"><button className="link" title="Quote this reply in the composer" onClick={() => window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: quoteReply(it.text) } }))}>Reply</button><button className="link" title="Copy this reply as Markdown" onClick={() => copyText(it.text).then(() => notice('Copied the reply'), () => notice('Copy failed'))}>Copy</button><button className="link" title="Save this reply to Notes" onClick={() => saveReply(it.text, cwd)}>Save as note</button></div>}</div>;
    case 'system':
      return <div className={`tr-system${it.error ? ' err' : ''}`}>{it.text}</div>;
    case 'step':
      return <Step use={it.use} result={it.result} cwd={cwd} settled={settled} />;
    case 'file':
      return isSpecPath(it.path) && !it.error ? <SpecCard id={it.id} slug={specSlug(it.path)} path={it.path} meta={it.uses[0].name === 'Write' ? 'Spec written' : `Spec edited · +${it.count.add} -${it.count.del}`} /> : <FileCard it={it} cwd={cwd} />;
    case 'agent':
      return <AgentRow it={it} cwd={cwd} card={card} />;
    case 'blocked':
      return <BlockedCard ev={it.ev} />;
    case 'review':
      return <ReviewCard ev={it.ev} />;
  }
}

function saveReply(text: string, cwd: string) {
  const st = getState();
  const note = replyNote(text, st.live.find((c) => c.id === st.session.id)?.title ?? '', cwd);
  assistantStore().capture(note.text, 'note', note.profile).then(() => notice('Saved to Notes'), () => notice('Could not save the note. Try again.'));
}

export function SinceBox({ chat, recap, at, onOpen, onDismiss }: { chat: string; recap: string; at?: number; onOpen: () => void; onDismiss: () => void }) {
  return (
    <TranscriptBox id={`since:${chat}`} className="tr-since" defaultOpen title="Since you left" meta={at ? clock(at) : undefined} action={<IconButton icon="close" label="Dismiss" size="sm" onClick={onDismiss} />}>
      <ListRow className="bd-clamp" title="Recap" meta={recap} aria-haspopup="dialog" onClick={onOpen} />
    </TranscriptBox>
  );
}

export function Explored({ id, run, cwd }: { id: string; run: StepItem[]; cwd: string }) {
  return (
    <TranscriptBox id={`explore:${id}`} title={`Explored ${exploreLabel(run)}`}>
      <div className="tr-explored">{run.map((s) => <Row key={s.id} it={s} cwd={cwd} />)}</div>
    </TranscriptBox>
  );
}

function Step({ use, result, cwd, settled }: { use: ToolUse; result?: ToolResult; cwd: string; settled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { verb, object, mono, cmd } = stepLabel(use.name, use.input, cwd);
  const state = !result ? (settled ? 'idle' : 'pending') : denied(result) ? 'denied' : result.isError ? 'err' : 'ok';
  const dur = result ? duration(result.at - use.at) : '';
  return (
    <div className={`tr-step tr-act t-${stepTone(use.name)} ${state} ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)}>
      <span className="tr-mark">{state === 'pending' ? <Icon name="loading" small spin /> : <i className="tr-hex" />}</span>
      <span className="tr-text" title={object} role="button" tabIndex={0} aria-expanded={open} onKeyDown={clickOnKey}>{verb && <span className="tr-verb">{verb} </span>}<span className={`tr-obj ${mono ? 'mono' : ''}`}>{object}</span></span>
      <span className="tr-dur">{dur}</span>
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

function FileCard({ it, cwd }: { it: Extract<Item, { kind: 'file' }>; cwd: string }) {
  const rel = relPath(it.path, cwd);
  const cut = rel.lastIndexOf('/');
  const name = rel.slice(cut + 1);
  return (
    <div className={`tr-file tr-act ${it.denied ? 'denied' : it.error ? 'err' : ''}`} title={rel} {...pressable(() => setUi({ openFile: rel, follow: false }))}>
      <FileIcon name={name} />
      <span className="tr-path"><span className="tr-dir">{cut >= 0 ? rel.slice(0, cut + 1) : ''}</span>{name}</span>
      {it.error ? (
        <span className="tr-err">{it.error}</span>
      ) : (
        <span className="tr-count"><span className="add">+{it.count.add}</span> <span className="del">-{it.count.del}</span></span>
      )}
    </div>
  );
}

function AgentRow({ it, cwd, card }: { it: Extract<Item, { kind: 'agent' }>; cwd: string; card?: boolean }) {
  const { use, result, steps, running } = it;
  const canStop = useCan('stopTask');
  const desc = typeof use.input.description === 'string' && use.input.description ? use.input.description : 'Sub-agent';
  const type = typeof use.input.subagent_type === 'string' ? use.input.subagent_type : '';
  const dur = result && !running ? duration(result.at - use.at) : '';
  const badge = running ? <Badge status="running" /> : result?.stopped ? <Badge status="skipped" reason="Stopped" /> : denied(result) ? <Badge status="skipped" reason="Denied" /> : result?.isError ? <Badge status="failed" /> : <Badge status="done" />;
  const build = card ? agentBuild(use) : null;
  return (
    <TranscriptBox
      id={`agent:${use.id}`}
      className={running ? 'running' : undefined}
      title={desc}
      meta={[type, dur, steps.length > 0 && plural(steps.length, 'step')].filter(Boolean).join(' · ')}
      state={badge}
      action={running && canStop ? <IconButton icon="debug-stop" label="Stop agent" size="sm" onClick={() => send({ type: 'stop_task', toolUseId: use.id })} /> : undefined}
      summary={agentSummary(it)}
    >
      {build && <SpecRow slug={build.slug} meta={`${stageName(build.stage)} · ${build.slug}`} />}
      {steps.length > 0 && <div className="tr-sub">{steps.map((s) => <Row key={s.id} it={s} cwd={cwd} settled={!running} />)}</div>}
      {result && !running && <div className="tr-report"><Markdown text={result.text || '(no output)'} id={it.id} /></div>}
    </TranscriptBox>
  );
}
