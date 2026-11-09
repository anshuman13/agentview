import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { forgetSeenBefore, getState, loadEarlier, notice, seenBefore, send, setUi, useStore } from '../app/store';
import { assistantStore } from '../codex/data';
import { quoteReply, replyNote } from './composerLogic';
import { Icon } from '../ui/Icon';
import { Markdown } from './Chat';
import { BlockedCard } from './Pending';
import { FileIcon } from '../workspace/FileIcon';
import { createTranscriptBuilder, denied, exploreLabel, exploreRuns, dayDividers, duration, newMarker, newReplies, firstLine, relPath, stepLabel, stepTone, type Item, type ToolResult, type ToolUse } from './steps';
import { clickOnKey, copyText, plural, pressable } from '../ui/util';
import { FIRST_ROWS, hiddenCount, revealMore, stageRows, windowStart } from './window';
import { ROW_WINDOW, type ChatEvent } from '../../../shared/protocol';

export function Transcript() {
  const events = useStore((s) => s.events);
  const cwd = useStore((s) => s.session.cwd);
  const running = useStore((s) => s.session.running);
  const chat = useStore((s) => s.session.id);
  const earlier = useStore((s) => s.earlier ?? 0);
  return <TranscriptView key={chat} events={events} earlier={earlier} cwd={cwd} running={running} />;
}

function lastUserId(items: Item[]) {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'user') return items[i].id;
  return '';
}

function TranscriptView({ events, earlier, cwd, running }: { events: ChatEvent[]; earlier: number; cwd: string; running: boolean }) {
  const [build] = useState(createTranscriptBuilder);
  const items = useMemo(() => build(events), [build, events]);
  const box = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const size = useRef('');
  const [stuck, setStuck] = useState(true);
  const [behind, setBehind] = useState(false);
  const [leftAt, setLeftAt] = useState('');
  const lastUser = useRef('');
  const [shown, setShown] = useState(ROW_WINDOW);
  const [staged, setStaged] = useState(FIRST_ROWS);
  const grew = useRef(0);
  const [loading, setLoading] = useState(false);
  const start = windowStart(items.length, shown);
  const from = windowStart(items.length, Math.min(staged, shown));
  const staging = staged < Math.min(shown, items.length);
  const last = events[events.length - 1];
  const runs = useMemo(() => exploreRuns(items), [items]);
  const [openRuns, setOpenRuns] = useState(() => new Set<string>());
  const seenTimes = useStore((s) => s.seen);
  const [mark, setMark] = useState(() => ({ seen: -1, openedAt: Date.now() }));
  // After a reload the seen times arrive after mount, so the mark waits for them.
  useEffect(() => {
    const id = getState().session.sessionId;
    if (mark.seen >= 0 || !id || seenBefore(id) < 0) return;
    setMark({ ...mark, seen: seenBefore(id) });
    forgetSeenBefore(id);
  }, [seenTimes, mark]);
  const days = useMemo(() => dayDividers(items, Date.now()), [items]);
  const newId = useMemo(() => newMarker(items, new Map(events.map((e) => [e.id, e.at])), mark.seen, mark.openedAt), [items, events, mark]);
  const folded = useMemo(() => new Set([...runs].filter(([id]) => !openRuns.has(id)).flatMap(([, r]) => r.slice(1).map((s) => s.id))), [runs, openRuns]);

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

  useLayoutEffect(() => {
    const el = box.current;
    const delta = el ? el.scrollHeight - grew.current : 0;
    if (el && grew.current && delta) {
      el.scrollTop += delta;
      grew.current = 0;
    }
  }, [shown, staged, items.length]);

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

  const showEarlier = async () => {
    if (loading) return;
    const mark = () => (grew.current = box.current?.scrollHeight ?? 0);
    if (start > 0) {
      mark();
      const next = revealMore(shown, items.length);
      setShown(next);
      setStaged(next);
      return;
    }
    setLoading(true);
    const ok = await loadEarlier();
    setLoading(false);
    // Marked only now: rows streamed in at the bottom during the load would otherwise spend the mark.
    if (ok) { mark(); setShown(shown + ROW_WINDOW); setStaged(shown + ROW_WINDOW); }
  };

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

  const replies = stuck ? 0 : newReplies(items, leftAt);

  const jump = () => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stick.current = true;
    setStuck(true);
    setBehind(false);
  };

  return (
    <div className="tr-host">
    <div ref={box} className="tr" onScroll={onScroll}>
      <div ref={rows} className="tr-rows">
      {items.length === 0 && <div className="tr-empty">No messages yet. Your prompts, Claude's steps and replies show up here.</div>}
      {!staging && (start > 0 || earlier > 0) && <div className="tr-more" {...pressable(showEarlier)}>{loading ? 'Loading earlier…' : `Show earlier (${hiddenCount(earlier, items.length, shown)} hidden)`}</div>}
      {items.slice(from).map((it, i) => {
        if (i > 0 && folded.has(it.id)) return null;
        const run = runs.get(it.id);
        if (run && !openRuns.has(it.id)) return <Explored key={it.id} label={exploreLabel(run)} onOpen={() => setOpenRuns(new Set(openRuns).add(it.id))} />;
        const row = <Row key={it.id} it={it} cwd={cwd} />;
        const day = days.get(it.id);
        return day || it.id === newId ? <Fragment key={it.id}>{day && <div className="tr-day"><span>{day}</span></div>}{it.id === newId && <div className="tr-new"><span>New</span></div>}{row}</Fragment> : row;
      })}
      </div>
    </div>
    {!stuck && (behind || running) && <button className="tr-jump" onClick={jump}><Icon name="arrow-down" small />Jump to latest{replies > 0 && ` · ${replies} new ${replies === 1 ? 'reply' : 'replies'}`}</button>}
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
      return a.use === o.use && a.result === o.result && a.running === o.running && a.steps.length === o.steps.length && a.steps.every((s, i) => sameItem(s, o.steps[i]));
    }
    case 'blocked':
      return a.ev === (b as typeof a).ev;
    default: {
      const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
      const keys = Object.keys(x);
      return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
    }
  }
}

export const Row = memo(RowImpl, (p, n) => p.cwd === n.cwd && p.settled === n.settled && sameItem(p.it, n.it));

function AutoRow({ it }: { it: Extract<Item, { kind: 'auto' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tr-auto" {...pressable(() => setOpen((v) => !v))} title={open ? 'Hide the prompt' : 'Show the full prompt'}>
      <Icon name={open ? 'chevron-down' : 'chevron-right'} small />{it.label}
      {open && <div className="tr-auto-text">{it.text}</div>}
    </div>
  );
}

function RowImpl({ it, cwd, settled }: { it: Item; cwd: string; settled?: boolean }) {
  switch (it.kind) {
    case 'user':
      return <div className={`tr-user ${it.stopping ? 'stopping' : ''} ${it.queued ? 'queued' : ''}`}>{it.text}{it.stopping && <span className="tr-stop"><Icon name="loading" small spin /></span>}{it.queued && <span className="tr-stop" title="Waiting for Claude's next step"><Icon name="clock" small /><button className="link tl-send-now" title="Stop Claude's current step and send this now" onClick={() => send({ type: 'send_now', id: it.id })}>Send now</button></span>}{!it.stopping && !it.queued && <span className="tr-acts"><button className="link" title="Put this prompt in the composer to edit and send again" onClick={() => window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: it.text } }))}>Use again</button></span>}</div>;
    case 'phase':
      return <div className="tr-phase"><Icon name="sync" small />{it.text}</div>;
    case 'auto':
      return <AutoRow it={it} />;
    case 'assistant':
      return <div className={`tr-assistant ${it.streaming ? 'streaming' : ''}`}><Markdown text={it.text} id={it.streaming ? undefined : it.id} />{!it.streaming && <div className="tr-acts"><button className="link" title="Quote this reply in the composer" onClick={() => window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: quoteReply(it.text) } }))}>Reply</button><button className="link" title="Copy this reply as Markdown" onClick={() => copyText(it.text).then(() => notice('Copied the reply'), () => notice('Copy failed'))}>Copy</button><button className="link" title="Save this reply to Notes" onClick={() => saveReply(it.text, cwd)}>Save as note</button></div>}</div>;
    case 'system':
      return <div className="tr-system">{it.text}</div>;
    case 'step':
      return <Step use={it.use} result={it.result} cwd={cwd} settled={settled} />;
    case 'file':
      return <FileCard it={it} cwd={cwd} />;
    case 'agent':
      return <AgentRow it={it} cwd={cwd} />;
    case 'blocked':
      return <BlockedCard ev={it.ev} />;
  }
}

function saveReply(text: string, cwd: string) {
  const st = getState();
  const note = replyNote(text, st.live.find((c) => c.id === st.session.id)?.title ?? '', cwd);
  assistantStore().capture(note.text, 'note', note.profile).then(() => notice('Saved to Notes'), () => notice('Could not save the note. Try again.'));
}

function Explored({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <div className="tr-step tr-act t-read ok" onClick={onOpen}>
      <span className="tr-mark"><i className="tr-hex" /></span>
      <span className="tr-text" role="button" tabIndex={0} aria-expanded={false} onKeyDown={clickOnKey}><span className="tr-verb">Explored </span><span className="tr-obj">{label}</span></span>
    </div>
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

function AgentRow({ it, cwd }: { it: Extract<Item, { kind: 'agent' }>; cwd: string }) {
  const { use, result, steps, running } = it;
  const [open, setOpen] = useState(false);
  const desc = typeof use.input.description === 'string' && use.input.description ? use.input.description : 'Sub-agent';
  const type = typeof use.input.subagent_type === 'string' ? use.input.subagent_type : '';
  const dur = result ? duration(result.at - use.at) : '';
  const state = running ? 'running' : result?.stopped ? 'stopped' : denied(result) ? 'denied' : result?.isError ? 'failed' : `done${dur ? ` ${dur}` : ''}`;
  const shown = open ? steps : running ? steps.slice(-3) : [];
  const canOpen = steps.length > 0 || Boolean(result);
  return (
    <div className="tr-agent-box tr-act">
      <div className={`tr-agent ${running ? 'running' : result?.isError && !denied(result) ? 'err' : 'done'} ${open ? 'open' : ''}`} onClick={() => canOpen && setOpen((v) => !v)}>
        <span className="tr-mark"><i className="tr-ring" /></span>
        <span className="tr-text" title={desc} role={canOpen ? 'button' : undefined} tabIndex={canOpen ? 0 : undefined} aria-expanded={canOpen ? open : undefined} onKeyDown={canOpen ? clickOnKey : undefined}>
          {desc}
          <span className="tr-state"> · {type && `${type} · `}{state}{steps.length > 0 && ` · ${plural(steps.length, 'step')}`}</span>
          {running && <Icon name="loading" small spin />}
        </span>
        {running && (
          <button className="icon-btn tr-stop" title="Stop this agent" aria-label="Stop agent" onClick={(e) => { e.stopPropagation(); send({ type: 'stop_task', toolUseId: use.id }); }}>
            <Icon name="debug-stop" small />
          </button>
        )}
        {canOpen && <span className="tr-dur"><Icon name={open ? 'chevron-down' : 'chevron-right'} small /></span>}
      </div>
      {shown.length > 0 && (
        <div className="tr-sub">
          {!open && steps.length > shown.length && <div className="tr-more" {...pressable(() => setOpen(true))}>{steps.length - shown.length} earlier steps</div>}
          {shown.map((s) => <Row key={s.id} it={s} cwd={cwd} settled={!running} />)}
        </div>
      )}
      {open && result && !running && <div className="tr-report"><Markdown text={result.text || '(no output)'} id={it.id} /></div>}
    </div>
  );
}
