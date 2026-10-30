import { useEffect, useRef, useState } from 'react';
import { touch } from '../app/touch';
import { listKeys } from './util';

export type PickItem = { value: string; label: string; detail?: string };

export function QuickPick({ title, items, current, anchor, extra, onPick, onClose }: {
  title: string;
  extra?: (q: string) => PickItem[];
  anchor?: DOMRect;
  items: PickItem[];
  current?: string | null;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(Math.max(0, items.findIndex((i) => i.value === current)));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!touch()) input.current?.focus(); }, []);
  const results = [...items.filter((i) => (i.label + ' ' + (i.detail ?? '')).toLowerCase().includes(q.toLowerCase())), ...(extra?.(q.trim()) ?? [])];

  return (
    <div className={`overlay ${anchor ? 'anchored' : ''}`} onClick={onClose}>
      <div
        className="switcher"
        style={anchor && {
          left: Math.max(8, Math.min(anchor.left, window.innerWidth - 348)),
          ...(anchor.top > window.innerHeight / 2 ? { bottom: window.innerHeight - anchor.top + 6, maxHeight: anchor.top - 14 } : { top: anchor.bottom + 6, maxHeight: window.innerHeight - anchor.bottom - 14 }),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          value={q}
          placeholder={title}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={listKeys({ count: results.length, idx, setIdx, onEnter: () => results[idx] && onPick(results[idx].value), onEscape: onClose })}
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
