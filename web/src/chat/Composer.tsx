import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, getState, notice, prompt, queueNext, send, sinceHeard, steer, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { Voice, useDictation } from './Voice';
import { QuickPick } from '../ui/QuickPick';
import { FileIcon } from '../workspace/FileIcon';
import { toolId } from '../ops/mcpHelpers';
import { touch } from '../app/touch';
import { Hl, wsUrl, plural, save, storedStrings } from '../ui/util';
import { COMPACT_AT, PERMISSION_MODES, type ChatEvent } from '../../../shared/protocol';
import { ChatSettings, useChatSettings, type Pick } from './ChatSettings';
import { accept, addUse, append, buildHistory, contextPercent, fileCache, filesEdited, ghostFor, rankCommands, rankFiles, readDraft, turnEnd, remember, repeatLabel, repeatPill, loopLabel, saveDraft, STORED_KEY, terminalId, triggerAt, uploadPaste, useLabel, withUses, type Use } from './composerLogic';

let editedFor: ChatEvent[] | undefined;
let editedCount = 0;
const editedOf = (events: ChatEvent[]) => (events === editedFor ? editedCount : ((editedFor = events), (editedCount = filesEdited(events))));

const MAX_HEIGHT = 220;

async function runInTerminal(cmd: string) {
  const id = await terminalId(api);
  if (!id) return notice('Terminal unavailable');
  window.dispatchEvent(new CustomEvent('agentview:terminal', { detail: id }));
  const ws = new WebSocket(wsUrl(`term=${encodeURIComponent(id)}`));
  ws.onerror = () => notice('Terminal unavailable');
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'i', d: `${cmd}\r` }));
    ws.close();
  };
}

type Hist = { list: string[]; index: number; draft: string };

export function Composer() {
  const cwd = useStore((s) => s.session.cwd);
  const chat = useStore((s) => s.session.id);
  const running = useStore((s) => s.session.running);
  const stopping = useStore((s) => s.session.stopping);
  const compacting = useStore((s) => s.session.compacting);
  const waiting = useStore((s) => s.pending.length > 0);
  const commands = useStore((s) => s.session.commands);
  const repeat = useStore((s) => s.session.repeat);
  const { mode, effort, loop, modelName, effortName, modeInfo } = useChatSettings();
  const [stale, setStale] = useState(0);
  useEffect(() => {
    const tick = () => setStale(document.visibilityState === 'visible' ? sinceHeard() : 0);
    const t = setInterval(tick, 5_000);
    return () => clearInterval(t);
  }, []);
  const context = useStore((s) => s.session.context);
  const userCount = useStore((s) => s.events.reduce((n, e) => n + (e.kind === 'user' ? 1 : 0), 0));
  const edited = useStore((s) => editedOf(s.events));
  const servers = useStore((s) => s.session.mcp).filter((m) => m.status === 'connected');

  const [pick, setPick] = useState<Pick | null>(null);
  const [uses, setUses] = useState<Use[]>([]);
  const [text, setText] = useState(() => readDraft(chat));
  const draftFor = useRef(chat);
  const picker = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [sentHistory, setSentHistory] = useState(() => storedStrings(STORED_KEY));
  const [hist, setHist] = useState<Hist | null>(null);
  const dictate = useDictation(text, setText);
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLUListElement>(null);
  const wantCaret = useRef<number | null>(null);

  const at = Math.min(caret, text.length);
  const trigger = useMemo(() => triggerAt(text, at), [text, at]);
  const shell = trigger?.kind === 'shell';
  const popKey = trigger && trigger.kind !== 'shell' ? `${trigger.kind}:${trigger.start}:${trigger.query}` : '';
  const items = useMemo(() => {
    if (!trigger || trigger.kind === 'shell' || popKey === dismissed) return [];
    return trigger.kind === 'command' ? rankCommands(commands, trigger.query) : rankFiles(files, trigger.query);
  }, [trigger, popKey, dismissed, commands, files]);
  const open = items.length > 0;
  const history = useMemo(() => buildHistory(getState().events, sentHistory), [chat, userCount, sentHistory]);
  const ghost = !open && !shell && at === text.length ? ghostFor(text, history) : '';
  const pct = contextPercent(context);
  const shortModel = modelName.replace(/\s*\(.*\)$/, '').replace(/^claude-([a-z]+)-(\d+)-(\d+).*$/, (_, n: string, a, b) => `${n[0].toUpperCase()}${n.slice(1)} ${a}.${b}`);
  const cycleMode = () => send({ type: 'set_permission_mode', mode: PERMISSION_MODES[(PERMISSION_MODES.indexOf(mode as never) + 1) % PERMISSION_MODES.length] });

  useEffect(() => {
    if (trigger?.kind !== 'file' || !cwd) return;
    let live = true;
    setFiles(fileCache.get(cwd) ?? []);
    fetch(api('/api/files')).then((r) => r.json()).then((f: string[]) => { fileCache.set(cwd, f); if (live) setFiles(f); }).catch(() => {});
    return () => void (live = false);
  }, [trigger?.kind, cwd]);

  useEffect(() => {
    if (draftFor.current === chat) return saveDraft(chat, text);
    draftFor.current = chat;
    setText(readDraft(chat));
    setUses([]);
    setHist(null);
    setPick(null);
  }, [chat, text]);

  useEffect(() => setSel(0), [popKey]);

  useEffect(() => {
    pop.current?.children[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0';
    const h = Math.max(el.scrollHeight, mirror.current?.offsetHeight ?? 0);
    el.style.height = `${Math.min(h, MAX_HEIGHT)}px`;
    if (mirror.current) mirror.current.style.visibility = h > MAX_HEIGHT ? 'hidden' : '';
    if (wantCaret.current !== null) {
      el.setSelectionRange(wantCaret.current, wantCaret.current);
      setCaret(wantCaret.current);
      wantCaret.current = null;
    }
  }, [text, ghost]);

  useLayoutEffect(() => {
    const el = pop.current;
    const anchor = card.current;
    if (!el || !anchor) return;
    const r = anchor.getBoundingClientRect();
    el.style.left = `${r.left}px`;
    el.style.width = `${r.width}px`;
    if (r.top - 8 >= el.offsetHeight) { el.style.bottom = `${window.innerHeight - r.top + 4}px`; el.style.top = ''; }
    else { el.style.top = `${r.bottom + 4}px`; el.style.bottom = ''; }
  }, [items]);

  const apply = (next: string, c = next.length) => {
    wantCaret.current = c;
    setText(next);
  };

  const choose = (i: number) => {
    if (!trigger || trigger.kind === 'shell' || !items[i]) return;
    const value = trigger.kind === 'command' ? `/${(items[i].item as { name: string }).name}` : `@${items[i].item as string}`;
    const r = accept(text, trigger.start, at, value);
    apply(r.text, r.caret);
  };

  const stepHistory = (dir: 1 | -1) => {
    const h = hist ?? { list: history, index: -1, draft: text };
    const index = Math.min(h.list.length - 1, h.index + dir);
    if (index < 0) { setHist(null); apply(h.draft); return; }
    setHist({ ...h, index });
    apply(h.list[index]);
  };

  const attach = async (list: File[]) => {
    for (const f of list) {
      try {
        const body = await uploadPaste(f);
        setText((t) => append(t, `[${f.type.startsWith('image/') ? 'Image' : 'File'}: ${body.path}] `));
      } catch (err) {
        notice(`Could not attach ${f.name || 'the file'}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    ta.current?.focus();
  };

  useEffect(() => {
    const shell = (window as { AgentViewShell?: { takeShared?: () => string } }).AgentViewShell;
    if (!shell?.takeShared) return;
    const take = () => {
      try {
        const items = JSON.parse(shell.takeShared!() || '[]') as { name: string; type: string; data: string; text?: string }[];
        for (const it of items) {
          if (it.text) setText((t) => append(t, `${it.text} `));
          else void attach([new File([Uint8Array.from(atob(it.data), (c) => c.charCodeAt(0))], it.name, { type: it.type })]);
        }
      } catch {
        notice('Could not read what was shared');
      }
    };
    take();
    window.addEventListener('agentview:shared', take);
    return () => window.removeEventListener('agentview:shared', take);
  }, []);

  useEffect(() => {
    const insert = (e: Event) => {
      const add = (e as CustomEvent<{ text: string }>).detail.text;
      setText((t) => {
        const next = append(t, add);
        wantCaret.current = next.length;
        return next;
      });
      requestAnimationFrame(() => ta.current?.focus());
    };
    window.addEventListener('agentview:insert', insert);
    return () => window.removeEventListener('agentview:insert', insert);
  }, []);

  useEffect(() => {
    const use = (e: Event) => {
      setUses((u) => addUse(u, (e as CustomEvent<Use>).detail));
      requestAnimationFrame(() => ta.current?.focus());
    };
    window.addEventListener('agentview:use', use);
    return () => window.removeEventListener('agentview:use', use);
  }, []);

  useEffect(() => {
    const focus = () => requestAnimationFrame(() => ta.current?.focus());
    window.addEventListener('agentview:focus', focus);
    return () => window.removeEventListener('agentview:focus', focus);
  }, []);

  const submit = (stop = false) => {
    const t = text.trim();
    if (!t) return;
    if (shell) {
      const cmd = t.slice(1).trim();
      if (cmd) runInTerminal(cmd).catch(() => notice('Terminal unavailable'));
    } else {
      const next = remember(t, sentHistory);
      setSentHistory(next);
      save(STORED_KEY, next);
      const full = withUses(t, uses);
      const lost = () => setText((cur) => (cur.trim() ? cur : t));
      if (running && (stop || waiting)) steer(full, lost);
      else if (running) queueNext(full, lost);
      else prompt(full, lost);
      if (full !== t) setUses([]);
    }
    setHist(null);
    apply('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const onEntry = hist !== null && text === hist.list[hist.index];
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % items.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + items.length) % items.length); return; }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(popKey); return; }
      const exact = trigger?.kind === 'command' && (items[sel]?.item as { name: string } | undefined)?.name === trigger.query;
      if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey && !exact)) { e.preventDefault(); choose(sel); return; }
    }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cycleMode(); return; }
    if (ghost && (e.key === 'Tab' || e.key === 'ArrowRight') && el.selectionStart === text.length) { e.preventDefault(); apply(text + ghost); return; }
    if (e.key === 'ArrowUp' && (text === '' || onEntry) && !text.slice(0, el.selectionStart).includes('\n')) { e.preventDefault(); stepHistory(1); return; }
    if (e.key === 'ArrowDown' && onEntry && !text.slice(el.selectionEnd).includes('\n')) { e.preventDefault(); stepHistory(-1); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e.metaKey || e.ctrlKey); }
  };

  const typed = text.trim().length > 0;
  const hint = shell ? 'Runs in the terminal' : '';
  const placeholder = waiting ? 'Answer below, or message Claude to stop and send' : compacting ? 'Sends when compacting is done' : running ? (touch() ? 'Claude reads this next · hold Send to stop' : 'Claude reads this at its next step · ⌘Enter stops and sends') : uses.length ? 'What should Claude do with it?' : 'Ask anything · / commands · @ files';
  const level = context === null ? '' : context >= COMPACT_AT ? 'over' : context >= COMPACT_AT * 0.75 ? 'near' : '';

  return (
    <div className="cp" data-mode={mode}>
      <div
        ref={card}
        className={`cp-card${shell ? ' shell' : ''}`}
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void attach([...e.dataTransfer.files]); } }}
      >
        {uses.length > 0 && (
          <div className="cp-uses">
            {uses.map((u) => (
              <span key={useLabel(u)} className="cp-use" title={u.tool ? `Claude is asked to use ${toolId(u.server, u.tool)}` : `Claude is asked to use the ${u.server} MCP server`}>
                <Icon name="plug" small /><span>{u.server}</span>{u.tool && <span className="mono">{u.tool}</span>}
                <button className="icon-btn" aria-label={`Remove ${u.tool ?? u.server}`} onClick={() => setUses((l) => l.filter((x) => x !== u))}><Icon name="close" small /></button>
              </span>
            ))}
          </div>
        )}
        <div className="cp-text">
          <div ref={mirror} className="cp-mirror" aria-hidden><span className="cp-typed">{text}</span><span className="cp-ghost">{ghost}</span></div>
          <textarea
            ref={ta}
            value={text}
            rows={1}
            placeholder={placeholder}
            spellCheck={!shell}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void attach([...e.clipboardData.files]); } }}
          />
        </div>
        {ghost && touch() && (
          <button className="cp-suggest" title="Use this suggestion" onPointerDown={(e) => e.preventDefault()} onClick={() => apply(text + ghost)}>
            <Icon name="arrow-right" small /><span>{text.length > 12 && '…'}{text.slice(-12)}<b>{ghost}</b></span>
          </button>
        )}
        <div className="cp-foot">
          <button className={`cp-pill cp-chip${loop.on ? ' loop' : ''}`} title={`${modeInfo.detail} (Shift+Tab to switch mode)${loop.on ? `. Loop on, up to ${loop.max} ${loop.max === 1 ? 'round' : 'rounds'}` : ''}`} onClick={(e) => setPick({ kind: 'menu', at: e.currentTarget.getBoundingClientRect() })}>
            <Icon name={modeInfo.icon} small /><span>{shortModel}{effort && ` · ${effortName}`} · {modeInfo.label}</span>{loop.on && <Icon name="sync" small />}<Icon name="chevron-down" small />
          </button>
          <span className="cp-spacer" />
          {servers.length > 0 && (
            <button className={`icon-btn mcp${uses.length ? ' on' : ''}`} title="Ask Claude to use an MCP server or tool" aria-label="Use an MCP server" onClick={(e) => setPick({ kind: 'mcp', at: e.currentTarget.getBoundingClientRect() })}>
              <Icon name="plug" small />
            </button>
          )}
          <input ref={picker} type="file" multiple hidden onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <button className="icon-btn attach" title="Add files for Claude to look at (or paste or drop them)" aria-label="Add files" onClick={() => picker.current?.click()}>
            <Icon name="file-add" small />
          </button>
          <Voice onText={dictate} />
          {running && !typed ? (
            <button className="cp-stop" title={stopping ? 'Stopping…' : 'Stop Claude'} aria-label={stopping ? 'Stopping' : 'Stop'} disabled={stopping} onClick={() => send({ type: 'interrupt' })}>
              <Icon name={stopping ? 'loading' : 'debug-stop'} small spin={stopping} />
            </button>
          ) : (
            <button
              className="cp-send"
              title={shell ? 'Run in the terminal (Enter)' : compacting ? 'Sends when compacting is done (Enter)' : running ? 'Send at Claude\'s next step (Enter), stop and send (⌘Enter or hold)' : 'Send (Enter)'}
              aria-label={shell ? 'Run' : 'Send'}
              disabled={!typed}
              onClick={(e) => submit(e.metaKey || e.ctrlKey)}
              onContextMenu={(e) => { if (!running) return; e.preventDefault(); submit(true); }}
            >
              <Icon name={shell ? 'terminal' : 'arrow-up'} small />
            </button>
          )}
        </div>
      </div>
      <div className="cp-under">
        {hint && <span className="cp-hint">{hint}</span>}
        <span className="cp-stats">
          {compacting ? <span><Icon name="loading" small spin /> Compacting…</span> : level && (
            <button className={`cp-ctx ${level}`} disabled={running} title={`${context!.toLocaleString()} tokens in context. ${running ? 'Compacts when this turn ends' : 'Tap to compact'}.`} onClick={() => send({ type: 'prompt', text: '/compact' })}>{pct}% context{!running && ' · compact'}</button>
          )}
          {edited > 0 && <span>{edited} {edited === 1 ? 'file' : 'files'} edited</span>}
          {loop.phase && <span className={`cp-phase ${loop.phase}`}>{loopLabel(loop)}</span>}
          {stale >= 30 && <span className="cp-phase cp-stale" title="Nothing has arrived from the server. The link is reopened after 50 s of silence.">No update for {stale}s</span>}
          {repeat && <button className="cp-ctx cp-phase" title={`${repeatLabel(repeat)}. Tap to stop ${repeat.goal ? 'checking' : 'the loop'}.`} onClick={() => send({ type: 'prompt', text: repeat.goal ? '/goal off' : '/loop off' })}>{repeatPill(repeat)}</button>}
        </span>
      </div>
      {open && (
        <ul ref={pop} className="cp-pop" role="listbox">
          {items.map((r, i) => {
            if (trigger?.kind === 'command') {
              const c = r.item as { name: string; description: string };
              return (
                <li key={c.name} role="option" aria-selected={i === sel} className={i === sel ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
                  <span className="cp-name">/<Hl text={c.name} hits={r.hits} /></span>
                  <span className="cp-detail">{c.description}</span>
                </li>
              );
            }
            const f = r.item as string;
            const base = f.lastIndexOf('/') + 1;
            return (
              <li key={f} role="option" aria-selected={i === sel} className={i === sel ? 'active' : ''} title={f} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
                <FileIcon name={f} />
                <span className="cp-name"><Hl text={f.slice(base)} hits={r.hits} from={base} /></span>
                <span className="cp-detail"><Hl text={f.slice(0, Math.max(base - 1, 0))} hits={r.hits} /></span>
              </li>
            );
          })}
        </ul>
      )}
      <Announcer key={chat} />
      <ChatSettings pick={pick} setPick={setPick} savedCount={sentHistory.length} />
      {pick?.kind === 'saved' && (
        <QuickPick
          anchor={pick.at}
          title="Saved prompts"
          items={[...sentHistory].reverse().map((t, i) => ({ value: String(i), label: t.replace(/\s+/g, ' ').slice(0, 200) }))}
          onPick={(v) => { apply([...sentHistory].reverse()[Number(v)]); setPick(null); ta.current?.focus(); }}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'mcp' && (
        <QuickPick
          anchor={pick.at}
          title="Use an MCP server"
          items={servers.map((m) => ({ value: m.name, label: m.name, detail: plural(m.tools?.length ?? 0, 'tool') }))}
          onPick={(v) => setPick({ kind: 'mcpTools', at: pick.at, server: v })}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'mcpTools' && (
        <QuickPick
          anchor={pick.at}
          title={`Tool from ${pick.server}`}
          items={[{ value: '', label: 'Any tool', detail: 'Claude picks' }, ...(servers.find((m) => m.name === pick.server)?.tools ?? []).map((t) => ({ value: t.name, label: t.name, detail: t.description }))]}
          onPick={(v) => { setUses((u) => addUse(u, v ? { server: pick.server!, tool: v } : { server: pick.server! })); setPick(null); ta.current?.focus(); }}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
}

// Tells a screen reader when Claude's turn ends or Claude asks something, without reading every streamed word.
function Announcer() {
  const running = useStore((s) => s.session.running);
  const ask = useStore((s) => s.pending[s.pending.length - 1]);
  const [text, setText] = useState('');
  const was = useRef(running);
  useEffect(() => {
    if (was.current && !running) setText(turnEnd(getState().events));
    was.current = running;
  }, [running]);
  useEffect(() => {
    if (ask) setText(ask.kind === 'question' ? `Claude asks: ${ask.questions[0]?.question ?? ''}` : `Claude asks for permission: ${ask.title}`);
  }, [ask?.id]);
  return <div className="sr-only" role="status">{text}</div>;
}
