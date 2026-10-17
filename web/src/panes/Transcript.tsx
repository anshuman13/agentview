import { useEffect, useMemo, useRef, useState } from 'react';
import { setUi, useStore } from '../store';
import { Icon } from '../Icon';
import { Markdown } from './Chat';
import { FileIcon } from './Explorer';
import { buildTranscript, duration, firstLine, relPath, stepLabel, type Item, type ToolResult, type ToolUse } from './steps';
import type { ChatEvent } from '../../../shared/protocol';
import '../transcript.css';

export function Transcript() {
  const events = useStore((s) => s.events);
  const cwd = useStore((s) => s.session.cwd);
  const running = useStore((s) => s.session.running);
  const stopping = useStore((s) => s.session.stopping);
  const status = useStore((s) => s.status);
  return <TranscriptView events={events} cwd={cwd} running={running} stopping={stopping} status={status} />;
}

export function TranscriptView({ events, cwd, running, stopping, status }: { events: ChatEvent[]; cwd: string; running: boolean; stopping: boolean; status: string }) {
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
      {running && (
        <div className="tr-working">
          <span className="tr-mark"><Icon name="loading" small spin /></span>
          <span className="tr-text">{stopping ? 'Stopping…' : status === 'Idle' ? 'Working' : status}</span>
        </div>
      )}
    </div>
  );
}

function Row({ it, cwd }: { it: Item; cwd: string }) {
  switch (it.kind) {
    case 'user':
      return <div className={`tr-user ${it.stopping ? 'stopping' : ''}`}>{it.text}{it.stopping && <span className="tr-stop"><Icon name="loading" small spin /></span>}</div>;
    case 'phase':
      return <div className="tr-phase"><Icon name="sync" small />{it.text}</div>;
    case 'assistant':
      return <div className={`tr-assistant ${it.streaming ? 'streaming' : ''}`}><Markdown text={it.text} /></div>;
    case 'system':
      return <div className="tr-system">{it.text}</div>;
    case 'step':
      return <Step use={it.use} result={it.result} cwd={cwd} />;
    case 'file':
      return <FileCard it={it} cwd={cwd} />;
    case 'agent':
      return <AgentRow use={it.use} result={it.result} />;
  }
}

function Step({ use, result, cwd }: { use: ToolUse; result?: ToolResult; cwd: string }) {
  const [open, setOpen] = useState(false);
  const { verb, object, mono } = stepLabel(use.name, use.input, cwd);
  const state = !result ? 'pending' : result.isError ? 'err' : 'ok';
  const dur = result ? duration(result.at - use.at) : '';
  return (
    <div className={`tr-step tr-act ${state} ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)}>
      <span className="tr-mark">{state === 'pending' ? <Icon name="loading" small spin /> : <i className="tr-hex" />}</span>
      <span className="tr-text" title={object}>{verb} <span className={`tr-obj ${mono ? 'mono' : ''}`}>{object}</span></span>
      <span className="tr-dur">{dur}</span>
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

function AgentRow({ use, result }: { use: ToolUse; result?: ToolResult }) {
  const [open, setOpen] = useState(false);
  const desc = typeof use.input.description === 'string' && use.input.description ? use.input.description : 'Sub-agent';
  const dur = result ? duration(result.at - use.at) : '';
  return (
    <div className={`tr-agent tr-act ${!result ? 'running' : result.isError ? 'err' : 'done'} ${open ? 'open' : ''}`} onClick={() => result && setOpen((v) => !v)}>
      <span className="tr-mark"><i className="tr-ring" /></span>
      <span className="tr-text" title={desc}>
        {desc}
        <span className="tr-state"> · {!result ? 'running' : result.isError ? 'failed' : `done${dur ? ` ${dur}` : ''}`}</span>
        {!result && <Icon name="loading" small spin />}
      </span>
      {open && result && <div className="tr-detail" onClick={(e) => e.stopPropagation()}><div className="tr-report"><Markdown text={result.text || '(no output)'} /></div></div>}
    </div>
  );
}
