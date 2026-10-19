import { useEffect, useMemo, useRef, useState } from 'react';
import { setUi, useStore } from '../store';
import { Icon } from '../Icon';
import { Markdown } from './Chat';
import { BlockedCard } from './Pending';
import { FileIcon } from './Explorer';
import { buildTranscript, duration, firstLine, relPath, stepLabel, stepTone, type Item, type ToolResult, type ToolUse } from './steps';
import type { ChatEvent } from '../../../shared/protocol';
import '../transcript.css';

export function Transcript() {
  const events = useStore((s) => s.events);
  const cwd = useStore((s) => s.session.cwd);
  const running = useStore((s) => s.session.running);
  return <TranscriptView events={events} cwd={cwd} running={running} />;
}

export function TranscriptView({ events, cwd, running }: { events: ChatEvent[]; cwd: string; running: boolean }) {
  const items = useMemo(() => buildTranscript(events), [events]);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = events[events.length - 1];

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items.length, last, running]);

  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <div ref={box} className="tr" onScroll={onScroll}>
      {items.length === 0 && <div className="tr-empty">No messages yet. Your prompts, Claude's steps and replies show up here.</div>}
      {items.map((it) => <Row key={it.id} it={it} cwd={cwd} />)}
    </div>
  );
}

function Row({ it, cwd, settled }: { it: Item; cwd: string; settled?: boolean }) {
  switch (it.kind) {
    case 'user':
      return <div className={`tr-user ${it.stopping ? 'stopping' : ''}`}>{it.text}{it.stopping && <span className="tr-stop"><Icon name="loading" small spin /></span>}{it.queued && <span className="tr-stop" title="Queued, sends when Claude finishes"><Icon name="clock" small /></span>}</div>;
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
  const state = !result ? (settled ? 'idle' : 'pending') : result.isError ? 'err' : 'ok';
  const dur = result ? duration(result.at - use.at) : '';
  return (
    <div className={`tr-step tr-act t-${stepTone(use.name)} ${state} ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)}>
      <span className="tr-mark">{state === 'pending' ? <Icon name="loading" small spin /> : <i className="tr-hex" />}</span>
      <span className="tr-text" title={object}>{verb && <span className="tr-verb">{verb} </span>}<span className={`tr-obj ${mono ? 'mono' : ''}`}>{object}</span></span>
      <span className="tr-dur">{dur}</span>
      {cmd && !open && <span className="tr-cmd" title={cmd}>$ {cmd.replace(/\s*\n\s*/g, ' ⏎ ')}</span>}
      {state === 'err' && !open && <span className="tr-err">{firstLine(result!.text) || 'Failed'}</span>}
      {open && <Detail use={use} result={result} />}
    </div>
  );
}

function Detail({ use, result }: { use: ToolUse; result?: ToolResult }) {
  const input = typeof use.input.command === 'string' ? use.input.command : JSON.stringify(use.input, null, 2);
  return (
    <div className="tr-detail" onClick={(e) => e.stopPropagation()}>
      <pre>{input}</pre>
      {result && <pre className={result.isError ? 'err' : ''}>{result.text || '(no output)'}</pre>}
    </div>
  );
}

function FileCard({ it, cwd }: { it: Extract<Item, { kind: 'file' }>; cwd: string }) {
  const rel = relPath(it.path, cwd);
  const cut = rel.lastIndexOf('/');
  const name = rel.slice(cut + 1);
  return (
    <div className={`tr-file tr-act ${it.error ? 'err' : ''}`} title={rel} onClick={() => setUi({ openFile: rel, follow: false })}>
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
  const state = running ? 'running' : result?.stopped ? 'stopped' : result?.isError ? 'failed' : `done${dur ? ` ${dur}` : ''}`;
  const shown = open ? steps : running ? steps.slice(-3) : [];
  const canOpen = steps.length > 0 || Boolean(result);
  return (
    <div className="tr-agent-box tr-act">
      <div className={`tr-agent ${running ? 'running' : result?.isError ? 'err' : 'done'} ${open ? 'open' : ''}`} onClick={() => canOpen && setOpen((v) => !v)}>
        <span className="tr-mark"><i className="tr-ring" /></span>
        <span className="tr-text" title={desc}>
          {desc}
          <span className="tr-state"> · {type && `${type} · `}{state}{steps.length > 0 && ` · ${steps.length} step${steps.length === 1 ? '' : 's'}`}</span>
          {running && <Icon name="loading" small spin />}
        </span>
        {canOpen && <span className="tr-dur"><Icon name={open ? 'chevron-down' : 'chevron-right'} small /></span>}
      </div>
      {shown.length > 0 && (
        <div className="tr-sub">
          {!open && steps.length > shown.length && <div className="tr-more" onClick={() => setOpen(true)}>{steps.length - shown.length} earlier steps</div>}
          {shown.map((s) => <Row key={s.id} it={s} cwd={cwd} settled={!running} />)}
        </div>
      )}
      {open && result && !running && <div className="tr-report"><Markdown text={result.text || '(no output)'} /></div>}
    </div>
  );
}
