import { useRef, useState } from 'react';
import { answerQuestion } from '../chatActions';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import type { PendingQuestion } from '../../../../shared/protocol';
import { useCardKeys } from './useCardKeys';

export function QuestionCard({ q, first }: { q: PendingQuestion; first: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState<string | null>(null);
  const qq = q.questions[step];
  const total = q.questions.length;
  const multi = Boolean(qq?.multiSelect);

  const go = (to: number) => { setStep(to); setPicked([]); setOther(null); };
  const answer = (value: string) => {
    const next = { ...answers, [qq.question]: value };
    if (step + 1 >= total) return answerQuestion(q.id, next);
    setAnswers(next);
    go(step + 1);
  };
  const pick = (label: string) => {
    if (!multi) return answer(label);
    setPicked(picked.includes(label) ? picked.filter((x) => x !== label) : [...picked, label]);
  };
  const result = [...picked, other?.trim() ?? ''].filter(Boolean).join(', ');

  useCardKeys(ref, first, (k) => {
    const n = Number(k);
    if (!qq || !Number.isInteger(n) || n < 1) return false;
    if (n <= qq.options.length) pick(qq.options[n - 1].label);
    else if (n === qq.options.length + 1) setOther(other ?? '');
    else return false;
    return true;
  });
  if (!qq) return null;

  return (
    <Panel ref={ref} className="pd" tabIndex={-1} role="group" aria-label={qq.question}>
      <div className="pd-head">
        <span className="pd-label">{qq.header || 'Question'}</span>
        {total > 1 && <span className="pd-count">{step + 1} of {total}</span>}
      </div>
      <div className="pd-ask">{qq.question}</div>
      <div className="pd-options" role={multi ? 'group' : 'radiogroup'}>
        {qq.options.map((o, n) => (
          <Option key={o.label} n={n + 1} multi={multi} on={picked.includes(o.label) || answers[qq.question] === o.label} onPick={() => pick(o.label)} label={o.label} description={o.description} preview={o.preview} />
        ))}
        {other === null ? (
          <Option n={qq.options.length + 1} multi={multi} on={false} onPick={() => setOther('')} label="Other" className="pd-other" />
        ) : (
          <input
            autoFocus
            className="pd-other-input"
            value={other}
            placeholder="Type your answer, Enter to send"
            aria-label="Your answer"
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && result && !e.nativeEvent.isComposing) answer(result);
              if (e.key === 'Escape') {
                setOther(null);
                requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('.pd-other')?.focus());
              }
            }}
          />
        )}
      </div>
      {(step > 0 || multi || other !== null) && (
        <div className="pd-actions pd-nav">
          {step > 0 && <Button size="sm" onClick={() => go(step - 1)}>Back</Button>}
          {(multi || other !== null) && (
            <Button size="sm" disabled={!result} onClick={() => answer(result)}>{step + 1 < total ? 'Next' : 'Done'}</Button>
          )}
        </div>
      )}
    </Panel>
  );
}

type OptionProps = { n: number; multi: boolean; on: boolean; label: string; description?: string; preview?: string; className?: string; onPick: () => void };

function Option({ n, multi, on, label, description, preview, className, onPick }: OptionProps) {
  return (
    <button className={`pd-option${on ? ' on' : ''}${className ? ` ${className}` : ''}`} role={multi ? 'checkbox' : 'radio'} aria-checked={on} onClick={onPick}>
      {multi ? <span className="pd-mark" aria-hidden>{on ? '[x]' : '[ ]'}</span> : <span className="pd-dot" aria-hidden />}
      <span className="pd-opt">
        <span className="pd-opt-label">{label}</span>
        {description && <span className="pd-opt-desc">{description}</span>}
        {preview && <pre className="pd-preview">{preview}</pre>}
      </span>
      {!multi && !className && <span className="pd-pick" aria-hidden>Pick</span>}
      <kbd>{n}</kbd>
    </button>
  );
}
