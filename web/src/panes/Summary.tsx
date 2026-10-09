import { useMemo } from 'react';
import { setUi, useStore } from '../store';
import type { ChatEvent } from '../../../shared/protocol';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

type Turn = {
  id: string;
  prompt: string;
  start: number;
  end: number | null;
  steps: string[];
  edits: string[];
  commands: string[];
  reads: number;
  errors: number;
  result: string | null;
  cost: number;
};

function buildTurns(events: ChatEvent[], cwd: string) {
  const turns: Turn[] = [];
  let prevCost = 0;
  for (const e of events) {
    if (e.kind === 'user') {
      turns.push({ id: e.id, prompt: e.text, start: e.at, end: null, steps: [], edits: [], commands: [], reads: 0, errors: 0, result: null, cost: 0 });
      continue;
    }
    const t = turns[turns.length - 1];
    if (!t) continue;
    if (e.kind === 'status') t.steps.push(e.text);
    if (e.kind === 'tool_use') {
      const fp = typeof e.input.file_path === 'string' ? e.input.file_path : '';
      if (EDIT_TOOLS.has(e.name) && fp) {
        const rel = cwd && fp.startsWith(cwd + '/') ? fp.slice(cwd.length + 1) : fp;
        if (!t.edits.includes(rel)) t.edits.push(rel);
      } else if (e.name === 'Bash') t.commands.push(String(e.input.command ?? ''));
      else if (e.name === 'Read' || e.name === 'Grep' || e.name === 'Glob') t.reads++;
    }
    if (e.kind === 'tool_result' && e.isError) t.errors++;
    if (e.kind === 'result') {
      t.result = e.text;
      t.end = e.at;
      t.cost = Math.max(0, e.costUsd - prevCost);
      prevCost = e.costUsd;
    }
  }
  return { turns, totalCost: prevCost };
}

export function Summary() {
  const events = useStore((s) => s.events);
  const cwd = useStore((s) => s.session.cwd);
  const running = useStore((s) => s.session.running);
  const subscription = useStore((s) => s.session.apiKeySource === 'none');
  const { turns, totalCost } = useMemo(() => buildTurns(events, cwd), [events, cwd]);
  const files = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of turns) for (const f of t.edits) m.set(f, (m.get(f) ?? 0) + 1);
    return [...m.entries()];
  }, [turns]);

  if (turns.length === 0) {
    return (
      <div className="summary-pane">
        <div className="section-title">Done so far</div>
        <div className="muted small">Nothing yet. Send Claude a task from the chat panel.</div>
      </div>
    );
  }

  const commands = turns.reduce((n, t) => n + t.commands.length, 0);
  const totals = [
    plural(turns.length, 'turn'),
    plural(commands, 'command'),
    plural(files.length, 'file'),
    totalCost > 0 && `$${totalCost.toFixed(2)}${subscription ? ' API equiv.' : ''}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="summary-pane">
      <div className="section-title">Done so far</div>
      <div className="muted small">{totals}</div>

      {files.length > 0 && (
        <div className="changed">
          <div className="label">Files changed</div>
          {files.map(([f, n]) => (
            <button key={f} className="file-row" title={f} onClick={() => setUi({ openFile: f, follow: false })}>
              <span className="name">{f.split('/').pop()}</span>
              <span className="muted small dir">{f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : ''}</span>
              {n > 1 && <span className="muted small">{n} turns</span>}
            </button>
          ))}
        </div>
      )}

      <div className="timeline">
        {[...turns].reverse().map((t, i) => {
          const live = !t.end && running && i === 0;
          const facts = [
            t.edits.length && plural(t.edits.length, 'file') + ' edited',
            t.commands.length && plural(t.commands.length, 'command'),
            t.errors && plural(t.errors, 'error'),
            t.end && t.end > t.start && duration(t.end - t.start),
            t.cost > 0 && `$${t.cost.toFixed(3)}`,
          ].filter(Boolean).join(' · ');
          return (
            <div key={t.id} className={`turn ${live ? 'live' : ''}`} onClick={() => scrollToEvent(t.id)} title={t.prompt}>
              <div className="turn-head">
                <span className="prompt">{firstLine(t.prompt)}</span>
                <span className="muted small when">{time(t.start)}</span>
              </div>
              {(facts || live) && <div className="muted small">{facts || 'Working…'}</div>}
              {live && t.steps.length > 0 && (
                <ul className="steps small">
                  {t.steps.map((s, j) => <li key={j}>{s}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function scrollToEvent(id: string) {
  document.querySelector(`[data-event="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function firstLine(t: string) {
  const l = t.trim().split('\n')[0] ?? '';
  return l.length > 90 ? l.slice(0, 90) + '…' : l;
}

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function duration(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
