import { useEffect, useRef, useState } from 'react';

export type PickItem = { value: string; label: string; detail?: string };

export function QuickPick({ title, items, current, onPick, onClose }: {
  title: string;
  items: PickItem[];
  current?: string | null;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(Math.max(0, items.findIndex((i) => i.value === current)));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const results = items.filter((i) => (i.label + ' ' + (i.detail ?? '')).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="switcher" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder={title}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, results.length - 1));
            if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0));
            if (e.key === 'Enter' && results[idx]) onPick(results[idx].value);
          }}
        />
        <ul>
          {results.map((i, n) => (
            <li key={i.value} className={n === idx ? 'active' : ''} onClick={() => onPick(i.value)}>
              <span>{i.label}</span>
              {i.detail && <span className="muted small detail">{i.detail}</span>}
              {i.value === current && <span className="tag">current</span>}
            </li>
          ))}
          {results.length === 0 && <li className="muted">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
