import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { send, setAtLatest, useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Button, IconButton } from '../../ui/Button';
import { EmptyState } from '../../ui/Panel';
import { Markdown } from '../Chat';
import { BlockedCard } from '../cards/Pending';
import { ReviewCard } from '../cards/ReviewCard';
import { AlarmCard } from './AlarmCard';
import { BuildCard } from './BuildCard';
import { SketchCard } from './SketchCard';
import { DocCard } from './DocCard';
import { SubChatRows } from './SubChatRows';
import { FindBar, findPending, markHit, takeFind, type FindRequest } from './FindBar';
import { showTurn, turnPending } from '../../sessions/openChat';
import { RewindLink } from './Rewind';
import { createFoldBuilder, type FoldRow } from './workFold';
import { ALARM_TOOL, BUILD_TOOL, createTranscriptBuilder, exploreRuns, dayDividers, newMarker, newReplies, openAtNew, rewindReplies, turnAnswers, docCards, isDocFile, fileMeta, sameItem, type Item, type Rewind } from './steps';
import { pressable } from '../../ui/util';
import { useCan } from '../useCan';
import { copyReply } from '../chatActions';
import { failedLine } from '../composer/composerLogic';
import { billing, providerLabel } from '../../../../shared/providers';
import { isSketchPath } from '../../../../shared/sketches';
import { hiddenCount } from './window';
import type { ChatEvent } from '../../../../shared/protocol';
import { useStickyScroll } from './useStickyScroll';
import { useRowWindow, useSeenMark } from './useRowWindow';
import { UnsentRows, UserRow } from './UserRow';
import { Tasks } from './TaskLines';
import { AgentRow, Explored, FileCard, Step } from './StepRows';
import { quoteText } from '../../../../shared/composerText';
import { useSelectionAt } from '../../ui/useSelectionAt';
import { freshReplies, knownIds } from './streamFade';

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
  // A hit in an earlier sub-chat opens that sub-chat's row at the hit instead of the find bar.
  const [subFind, setSubFind] = useState<FindRequest | null>(null);
  const begin = () => {
    const request = takeFind(chatId.current);
    if (request?.sub && request.sub !== chatId.current) { setSubFind(request); return 'sub'; }
    if (request) setBegun((b) => ({ n: b.n + 1, request }));
    return request;
  };
  useEffect(() => {
    const first = begin();
    if (first && first !== 'sub') setFinding(true);
    const open = () => { if (begin() === 'sub') return; setFinding(true); document.querySelector<HTMLInputElement>('.tr-find input')?.focus(); };
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
  const known = useRef<Set<string> | null>(null);
  const fresh = freshReplies(known.current, items);
  useEffect(() => { known.current = knownIds(known.current, items); }, [items]);

  const rowOf = (it: Item, first: boolean) => {
    if (!first && folded.has(it.id)) return null;
    const run = runs.get(it.id);
    if (run) return <Explored key={it.id} id={it.id} run={run} cwd={cwd} />;
    return <Row key={it.id} it={it} cwd={cwd} settled={!running} card={cards.has(it.id)} answer={answers.has(it.id)} rewind={canRewind && !running ? rewinds.get(it.id) : undefined} fresh={fresh.has(it.id)} />;
  };

  return (
    <div className="tr-host">
    {finding && <FindBar key={begun.n} events={events} earlier={earlier} start={begun.request} go={goToHit} onClose={() => setFinding(false)} />}
    <div ref={box} className="tr" onScroll={onScroll}>
      <div ref={rows} className="tr-rows">
      <SubChatRows sessionId={sessionId} cwd={cwd} find={subFind} unstick={() => { scroll.stick.current = false; }} />
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
        <Icon name="arrow-down" small />
        {replies > 0 && <span className="badge quiet">{replies > 9 ? '9+' : replies}</span>}
      </button>
    )}
    </div>
  );
}

export const Row = memo(RowImpl, (p, n) => p.cwd === n.cwd && p.settled === n.settled && p.card === n.card && p.answer === n.answer && p.rewind?.id === n.rewind?.id && p.readOnly === n.readOnly && sameItem(p.it, n.it));

function RowImpl({ it, cwd, settled, card, answer, rewind, readOnly, fresh }: { it: Item; cwd: string; settled?: boolean; card?: boolean; answer?: boolean; rewind?: Rewind; readOnly?: boolean; fresh?: boolean }) {
  const label = useStore((s) => providerLabel(s.session.provider));
  switch (it.kind) {
    case 'user':
      return <UserRow it={it} label={label} readOnly={readOnly} />;
    case 'assistant':
      return <div id={`turn-${it.id}`} className={`tr-assistant ${it.streaming ? 'streaming' : ''}`}><Markdown text={it.text} id={it.streaming ? undefined : it.id} fade={it.streaming} fresh={fresh} />{!it.streaming && (answer || rewind) && <div className="tr-acts">{answer && <IconButton icon="copy" label="Copy" onClick={() => copyReply(it.text.trim())} />}{rewind && <RewindLink rewind={rewind} />}</div>}</div>;
    case 'system':
      return <div className={`tr-system${it.error ? ' err' : ''}`}>{it.text}</div>;
    case 'step':
      if (it.use.name === ALARM_TOOL) return <AlarmCard use={it.use} result={it.result} running={!settled} />;
      if (it.use.name === BUILD_TOOL) return <BuildCard use={it.use} result={it.result} />;
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
