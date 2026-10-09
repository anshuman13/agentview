import { useState } from 'react';
import { send, useStore } from '../store';
import type { PendingPermission, PendingQuestion } from '../../../shared/protocol';

export function Pending() {
  const pending = useStore((s) => s.pending);
  return <>{pending.map((p) => (p.kind === 'question' ? <Question key={p.id} q={p} /> : <Permission key={p.id} p={p} />))}</>;
}

function Question({ q }: { q: PendingQuestion }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const done = q.questions.every((qq) => answers[qq.question] || other[qq.question]);

  const submit = () => {
    const final: Record<string, string> = {};
    for (const qq of q.questions) final[qq.question] = other[qq.question]?.trim() || answers[qq.question];
    send({ type: 'answer', id: q.id, answers: final });
  };

  return (
    <div className="card question">
      <div className="label">Claude asks</div>
      {q.questions.map((qq) => (
        <div key={qq.question} className="q">
          <div className="chip">{qq.header}</div>
          <div className="q-text">{qq.question}</div>
          <div className="options">
            {qq.options.map((o) => {
              const selected = qq.multiSelect
                ? (answers[qq.question] ?? '').split(', ').includes(o.label)
                : answers[qq.question] === o.label;
              return (
                <button
                  key={o.label}
                  className={`option ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    if (!qq.multiSelect) return setAnswers({ ...answers, [qq.question]: o.label });
                    const cur = (answers[qq.question] ?? '').split(', ').filter(Boolean);
                    const next = selected ? cur.filter((x) => x !== o.label) : [...cur, o.label];
                    setAnswers({ ...answers, [qq.question]: next.join(', ') });
                  }}
                >
                  <div className="opt-label">{o.label}</div>
                  <div className="opt-desc">{o.description}</div>
                </button>
              );
            })}
          </div>
          <input
            placeholder="Other…"
            value={other[qq.question] ?? ''}
            onChange={(e) => setOther({ ...other, [qq.question]: e.target.value })}
          />
        </div>
      ))}
      <button className="primary" disabled={!done} onClick={submit}>Answer</button>
    </div>
  );
}

function Permission({ p }: { p: PendingPermission }) {
  return (
    <div className="card permission">
      <div className="label">Permission</div>
      <div className="q-text">{p.title}</div>
      <pre className="mono small wrap">{preview(p)}</pre>
      <div className="row">
        <button className="primary" onClick={() => send({ type: 'permission', id: p.id, allow: true })}>Allow</button>
        {p.canAlwaysAllow && (
          <button onClick={() => send({ type: 'permission', id: p.id, allow: true, always: true })}>Always</button>
        )}
        <button className="danger" onClick={() => send({ type: 'permission', id: p.id, allow: false })}>Deny</button>
      </div>
    </div>
  );
}

function preview(p: PendingPermission) {
  const i = p.input;
  if (typeof i.command === 'string') return i.command;
  if (typeof i.file_path === 'string') return i.file_path;
  return JSON.stringify(i, null, 2).slice(0, 600);
}
