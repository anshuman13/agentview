import { useEffect, useMemo, useRef, useState } from 'react';
import { Marked } from 'marked';
import { send, useStore } from '../store';
import { Pending } from './Pending';
import type { ChatEvent } from '../../../shared/protocol';

export function Chat() {
  const events = useStore((s) => s.events);
  const running = useStore((s) => s.session.running);
  const waiting = useStore((s) => s.pending.length > 0);
  const commands = useStore((s) => s.session.commands);
  const cwd = useStore((s) => s.session.cwd);
  const mode = useStore((s) => s.session.permissionMode);
  const results = useMemo(() => {
    const m = new Map<string, ToolResult>();
    for (const e of events) if (e.kind === 'tool_result') m.set(e.toolUseId, e);
    return m;
  }, [events]);
  const [text, setText] = useState('');
  const [cmdIdx, setCmdIdx] = useState(0);
  const cmdMatches = useMemo(() => {
    const m = /^\/(\S*)$/.exec(text);
    if (!m) return [];
    const needle = m[1].toLowerCase();
    return commands.filter((c) => c.name.toLowerCase().startsWith(needle)).slice(0, 12);
  }, [text, commands]);
  const bottom = useRef<HTMLDivElement>(null);
  const [, rerender] = useState(0);
  const canNotify = 'Notification' in window && Notification.permission === 'default';

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [events.length, events[events.length - 1], waiting]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    send({ type: 'prompt', text: t });
    setText('');
  };

  return (
    <div className="chat">
      <div className="messages">
        {events.map((e) => <Event key={e.id} e={e} results={results} cwd={cwd} />)}
        <Pending />
        <div ref={bottom} />
      </div>
      <div className="composer" data-mode={mode ?? 'default'}>
        {cmdMatches.length > 0 && (
          <ul className="cmd-popup">
            {cmdMatches.map((c, i) => (
              <li key={c.name} className={i === cmdIdx ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); setText(`/${c.name} `); }}>
                <span>/{c.name}</span>
                <span className="muted small detail">{c.description}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          value={text}
          rows={1}
          placeholder={waiting ? 'Claude is waiting for your answer above. Messages typed here are queued.' : running ? 'Claude is working. You can still queue a message.' : 'Tell Claude what to do… type / for commands'}
          onChange={(e) => { setText(e.target.value); setCmdIdx(0); }}
          onKeyDown={(e) => {
            if (cmdMatches.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIdx((i) => Math.min(i + 1, cmdMatches.length - 1)); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIdx((i) => Math.max(i - 1, 0)); return; }
              if (e.key === 'Tab' || (e.key === 'Enter' && text !== `/${cmdMatches[cmdIdx].name}`)) {
                e.preventDefault();
                setText(`/${cmdMatches[cmdIdx].name} `);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-foot">
          <span className="muted small keys">⏎ send · ⇧⏎ new line · / commands</span>
          {canNotify && (
            <button className="ghost small" onClick={() => Promise.resolve(Notification.requestPermission()).catch(() => {}).finally(() => rerender((n) => n + 1))}>
              Enable notifications
            </button>
          )}
          <span className="spacer" />
          {running && <button className="ghost small" onClick={() => send({ type: 'interrupt' })}>Stop</button>}
          <button className="send" title="Send" disabled={!text.trim()} onClick={submit}>↑</button>
        </div>
      </div>
    </div>
  );
}

const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

function escapeHtml(t: string) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => md.parse(text, { async: false }) as string, [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

type ToolResult = Extract<ChatEvent, { kind: 'tool_result' }>;

function toolLabel(name: string) {
  return name.startsWith('mcp__') ? name.split('__').slice(2).join('__') : name;
}

function toolArg(input: Record<string, unknown>, cwd: string) {
  const v = [input.command, input.file_path, input.pattern, input.url, input.description, input.query].find((x) => typeof x === 'string') as string | undefined;
  if (!v) return '';
  return cwd && v.startsWith(cwd + '/') ? v.slice(cwd.length + 1) : v;
}

function Event({ e, results, cwd }: { e: ChatEvent; results: Map<string, ToolResult>; cwd: string }) {
  switch (e.kind) {
    case 'user':
      return <div className="msg user" data-event={e.id}><div className="bubble">{e.text}</div></div>;
    case 'assistant':
      return (
        <div className={`msg tl ${e.streaming ? 'dot-progress' : ''}`}>
          <Markdown text={e.text} />
        </div>
      );
    case 'tool_use': {
      if (e.name === 'mcp__agentview__set_status') return null;
      const r = results.get(e.id);
      const input = typeof e.input.command === 'string' ? e.input.command : JSON.stringify(e.input, null, 2);
      return (
        <details className={`msg tl tool ${!r ? 'dot-progress' : r.isError ? 'dot-fail' : 'dot-ok'}`}>
          <summary>
            <span className="tool-name">{toolLabel(e.name)}</span>
            <span className="tool-arg">{toolArg(e.input, cwd)}</span>
          </summary>
          <div className="tool-body">
            <div className="tool-row"><span className="k">IN</span><pre>{input}</pre></div>
            {r && <div className={`tool-row ${r.isError ? 'error' : ''}`}><span className="k">OUT</span><pre>{r.text || '(no output)'}</pre></div>}
          </div>
        </details>
      );
    }
    case 'status':
      return <div className="msg tl status">{e.text}</div>;
    case 'system':
      return <div className="msg system">{e.text}</div>;
    default:
      return null;
  }
}
