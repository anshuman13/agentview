import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { Markdown } from './Chat';
import type { PendingPermission, PendingQuestion } from '../../../shared/protocol';
import '../pending.css';

export function Pending() {
  const pending = useStore((s) => s.pending);
  if (!pending.length) return null;
  return (
    <div className="pd-list">
      {pending.map((p, n) => (p.kind === 'question' ? <Question key={p.id} q={p} first={n === 0} /> : <Permission key={p.id} p={p} first={n === 0} />))}
    </div>
  );
}

function useKeys(ref: RefObject<HTMLElement | null>, first: boolean, onKey: (key: string) => boolean | void) {
  const cb = useRef(onKey);
  cb.current = onKey;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || document.querySelector('.overlay')) return;
      const el = document.activeElement;
      if (el?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (!first && !(el && ref.current?.contains(el))) return;
      if (cb.current(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [first, ref]);
}

const MODE_HINTS: Record<string, string> = {
  auto: 'Auto mode asks only for risky actions',
  default: 'Default mode asks before edits and commands',
  acceptEdits: 'Accept edits mode asks before commands, not file edits',
  plan: 'Plan mode asks before it starts building',
};

const ICONS: Record<string, string> = {
  Bash: 'terminal', Edit: 'edit', MultiEdit: 'edit', Write: 'new-file', WebFetch: 'globe', WebSearch: 'search', ExitPlanMode: 'checklist', Agent: 'sparkle', Task: 'sparkle',
};

function toolLabel(name: string) {
  if (name === 'ExitPlanMode') return 'Plan';
  const [mcp, server, tool] = name.split('__');
  return mcp === 'mcp' && tool ? `${server} ${tool}` : name;
}

function Permission({ p, first }: { p: PendingPermission; first: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mode = useStore((s) => s.session.permissionMode) ?? 'default';
  const isPlan = p.toolName === 'ExitPlanMode';
  const plan = typeof p.input.plan === 'string' ? p.input.plan : '';
  const always = p.canAlwaysAllow && !isPlan;
  const reply = (allow: boolean, all?: boolean) => send({ type: 'permission', id: p.id, allow, always: all });
  const keys = !p.confirmFirst;
  useKeys(ref, first, (k) => {
    if (k === 'n') reply(false);
    else if (k === 'y' && keys) reply(true);
    else if (k === 'a' && keys && always) reply(true, true);
    else return false;
    return true;
  });

  return (
    <div ref={ref} className={`pd${isPlan ? ' pd-plan-card' : ''}`} tabIndex={-1} role="group" aria-label={p.title}>
      <div className="pd-head">
        <Icon name={ICONS[p.toolName] ?? 'tools'} />
        <span className="pd-tool">{toolLabel(p.toolName)}</span>
        <span className="pd-title" title={p.title}>{p.title}</span>
      </div>
      {isPlan ? plan && <div className="pd-plan"><Markdown text={plan} /></div> : <Body p={p} />}
      {p.detail && <div className="pd-desc">{p.detail}</div>}
      <div className="pd-actions">
        <button className="pd-btn primary" onClick={() => reply(true)}>{isPlan ? 'Approve' : 'Allow'}{keys && <kbd>Y</kbd>}</button>
        {always && <button className="pd-btn" onClick={() => reply(true, true)}>Always allow{keys && <kbd>A</kbd>}</button>}
        <button className="pd-btn deny" autoFocus={p.confirmFirst} onClick={() => reply(false)}>{isPlan ? 'Keep planning' : 'Deny'}<kbd>N</kbd></button>
      </div>
      {MODE_HINTS[mode] && <div className="pd-hint">{MODE_HINTS[mode]}</div>}
    </div>
  );
}

function Body({ p }: { p: PendingPermission }) {
  const i = p.input;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (p.toolName) {
    case 'Bash':
      return <>{s(i.description) && <div className="pd-desc">{s(i.description)}</div>}<pre className="pd-code">{s(i.command)}</pre></>;
    case 'Edit':
    case 'Write':
    case 'MultiEdit': {
      const edits = p.toolName === 'Write' ? [{ new_string: i.content }] : p.toolName === 'Edit' ? [i] : Array.isArray(i.edits) ? (i.edits as Record<string, unknown>[]) : [];
      return <><div className="pd-path">{s(i.file_path)}</div>{edits.map((e, n) => <Diff key={n} a={s(e.old_string)} b={s(e.new_string)} />)}</>;
    }
    case 'WebFetch':
      return <><a className="pd-path" href={s(i.url)} target="_blank" rel="noreferrer">{s(i.url)}</a>{s(i.prompt) && <div className="pd-desc">{s(i.prompt)}</div>}</>;
    case 'WebSearch':
      return <div className="pd-path">{s(i.query)}</div>;
  }
  const rows = Object.entries(i).filter(([, v]) => v !== undefined && v !== '');
  if (!rows.length) return null;
  return <div className="pd-rows">{rows.map(([k, v]) => <Row key={k} k={k} v={typeof v === 'string' ? v : JSON.stringify(v, null, 2)} />)}</div>;
}

function Row({ k, v }: { k: string; v: string }) {
  const [open, setOpen] = useState(false);
  const long = v.length > 160 || v.split('\n').length > 3;
  return (
    <>
      <span className="pd-key">{k}</span>
      <span className="pd-val">
        <span className={long && !open ? 'pd-clip' : undefined}>{v}</span>
        {long && <button className="pd-more" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</button>}
      </span>
    </>
  );
}

const MAX_LINES = 200;

function Diff({ a, b }: { a: string; b: string }) {
  const lines = useMemo(() => lineDiff(a, b), [a, b]);
  return (
    <pre className="pd-diff">
      {lines.slice(0, MAX_LINES).map(([t, l], n) => <div key={n} className={t === '+' ? 'add' : t === '-' ? 'del' : undefined}>{t} {l}</div>)}
      {lines.length > MAX_LINES && <div className="pd-cut">{lines.length - MAX_LINES} more lines</div>}
    </pre>
  );
}

export type DiffLine = [' ' | '-' | '+', string];

export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a ? a.split('\n') : [];
  const y = b ? b.split('\n') : [];
  const n = x.length, m = y.length;
  if (n * m > 250_000) return [...x.map((l): DiffLine => ['-', l]), ...y.map((l): DiffLine => ['+', l])];
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) out.push([' ', x[i++]]), j++;
    else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) out.push(['-', x[i++]]);
    else out.push(['+', y[j++]]);
  }
  return out;
}

function Question({ q, first }: { q: PendingQuestion; first: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState<string | null>(null);
  const qq = q.questions[step];
  const total = q.questions.length;

  const go = (to: number) => { setStep(to); setPicked([]); setOther(null); };
  const answer = (value: string) => {
    const next = { ...answers, [qq.question]: value };
    if (step + 1 >= total) return send({ type: 'answer', id: q.id, answers: next });
    setAnswers(next);
    go(step + 1);
  };
  const pick = (label: string) => {
    if (!qq.multiSelect) return answer(label);
    setPicked(picked.includes(label) ? picked.filter((x) => x !== label) : [...picked, label]);
  };
  const result = [...picked, other?.trim() ?? ''].filter(Boolean).join(', ');

  useKeys(ref, first, (k) => {
    const n = Number(k);
    if (!qq || !Number.isInteger(n) || n < 1) return false;
    if (n <= qq.options.length) pick(qq.options[n - 1].label);
    else if (n === qq.options.length + 1) setOther(other ?? '');
    else return false;
    return true;
  });
  if (!qq) return null;

  return (
    <div ref={ref} className="pd" tabIndex={-1} role="group" aria-label={qq.question}>
      <div className="pd-head">
        <Icon name="question" />
        <span className="pd-tool">{qq.header || 'Question'}</span>
        {total > 1 && <span className="pd-progress">{step + 1} of {total}</span>}
      </div>
      <div className="pd-ask">{qq.question}</div>
      <div className="pd-options" role={qq.multiSelect ? 'group' : 'radiogroup'}>
        {qq.options.map((o, n) => {
          const on = picked.includes(o.label);
          return (
            <button key={o.label} className={`pd-option${on ? ' on' : ''}`} role={qq.multiSelect ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => pick(o.label)}>
              <kbd>{n + 1}</kbd>
              {qq.multiSelect && <span className="pd-check">{on && <Icon name="check" small />}</span>}
              <span className="pd-opt">
                <span className="pd-opt-label">{o.label}</span>
                {o.description && <span className="pd-opt-desc">{o.description}</span>}
                {o.preview && <span className="pd-preview">{o.preview}</span>}
              </span>
            </button>
          );
        })}
        {other === null ? (
          <button className="pd-option pd-other" onClick={() => setOther('')}>
            <kbd>{qq.options.length + 1}</kbd>
            <span className="pd-opt-label">Other…</span>
          </button>
        ) : (
          <input
            autoFocus
            className="pd-other-input"
            value={other}
            placeholder="Type your answer, Enter to send"
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && result) answer(result);
              if (e.key === 'Escape') setOther(null);
            }}
          />
        )}
      </div>
      {(step > 0 || qq.multiSelect || other !== null) && (
        <div className="pd-actions">
          {(qq.multiSelect || other !== null) && (
            <button className="pd-btn primary" disabled={!result} onClick={() => answer(result)}>{step + 1 < total ? 'Next' : 'Done'}</button>
          )}
          {step > 0 && <button className="pd-btn ghost" onClick={() => go(step - 1)}>Back</button>}
        </div>
      )}
    </div>
  );
}
