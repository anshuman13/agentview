import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadEarlier, send, setUi, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { Markdown } from './Chat';
import { BlockedCard } from './Pending';
import { FileIcon } from '../workspace/FileIcon';
import { buildTranscript, denied, duration, firstLine, relPath, stepLabel, stepTone, type Item, type ToolResult, type ToolUse } from './steps';
import { clickOnKey, plural, pressable } from '../ui/util';
import { hiddenCount, revealMore, windowStart } from './window';
import { ROW_WINDOW, type ChatEvent } from '../../../shared/protocol';

export function Transcript() {
  const events = useStore((s) => s.events);
  const cwd = useStore((s) => s.session.cwd);
  const running = useStore((s) => s.session.running);
  const chat = useStore((s) => s.session.id);
  const earlier = useStore((s) => s.earlier ?? 0);
  return <TranscriptView key={chat} events={events} earlier={earlier} cwd={cwd} running={running} />;
}

function TranscriptView({ events, earlier, cwd, running }: { events: ChatEvent[]; earlier: number; cwd: string; running: boolean }) {
  const items = useMemo(() => buildTranscript(events), [events]);
  const box = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const size = useRef('');
  const [stuck, setStuck] = useState(true);
  const [behind, setBehind] = useState(false);
  const lastUser = useRef('');
  const [shown, setShown] = useState(ROW_WINDOW);
  const grew = useRef(0);
  const [loading, setLoading] = useState(false);
  const start = windowStart(items.length, shown);
  const last = events[events.length - 1];

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const mine = [...items].reverse().find((i) => i.kind === 'user')?.id ?? '';
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
  }, [shown, items.length]);

  const showEarlier = async () => {
    if (loading) return;
    grew.current = box.current?.scrollHeight ?? 0;
    if (start > 0) return setShown(revealMore(shown, items.length));
    setLoading(true);
    const ok = await loadEarlier();
    setLoading(false);
    if (ok) setShown(shown + ROW_WINDOW);
    else grew.current = 0;
  };

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    // The browser scrolls on its own when the content or box changes size; only a scroll at a steady size is the user's.
    const now = `${el.scrollHeight},${el.clientHeight}`;
    if (now !== size.current) { size.current = now; return; }
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
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

  return (
    <div className="tr-host">
    <div ref={box} className="tr" onScroll={onScroll}>
      <div ref={rows} className="tr-rows">
      {items.length === 0 && <div className="tr-empty">No messages yet. Your prompts, Claude's steps and replies show up here.</div>}
      {(start > 0 || earlier > 0) && <div className="tr-more" {...pressable(showEarlier)}>{loading ? 'Loading earlier' : `Show earlier (${hiddenCount(earlier, items.length, shown)} hidden)`}</div>}
      {items.slice(start).map((it) => <Row key={it.id} it={it} cwd={cwd} />)}
      </div>
    </div>
    {!stuck && (behind || running) && <button className="tr-jump" onClick={jump}><Icon name="arrow-down" small />Jump to latest</button>}
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

function RowImpl({ it, cwd, settled }: { it: Item; cwd: string; settled?: boolean }) {
  switch (it.kind) {
    case 'user':
      return <div className={`tr-user ${it.stopping ? 'stopping' : ''} ${it.queued ? 'queued' : ''}`}>{it.text}{it.stopping && <span className="tr-stop"><Icon name="loading" small spin /></span>}{it.queued && <span className="tr-stop" title="Waiting for Claude's next step"><Icon name="clock" small /><button className="link tl-send-now" title="Stop Claude's current step and send this now" onClick={() => send({ type: 'send_now', id: it.id })}>Send now</button></span>}</div>;
    case 'phase':
      return <div className="tr-phase"><Icon name="sync" small />{it.text}</div>;
    case 'assistant':
      return <div className={`tr-assistant ${it.streaming ? 'streaming' : ''}`}><Markdown text={it.text} /></div>;
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
      {open && result && !running && <div className="tr-report"><Markdown text={result.text || '(no output)'} /></div>}
    </div>
  );
}
