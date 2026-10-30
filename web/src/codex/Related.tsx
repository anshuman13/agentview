import { useEffect, useMemo, useState } from 'react';
import { useAssistantData, useCodex } from './data';
import { related, type Related as Hit } from './data/search';
import { dayLabel } from './data/dates';
import { Icon } from '../ui/Icon';
import { safeHref } from '../ui/util';
import { openMeeting, setView } from './view';
import { MEMORY } from './wiki/shared';

const WAIT = 300;
const ICON: Record<Hit['kind'], string> = { wiki: 'book', meeting: 'record', slack: 'comment-discussion' };
const KIND: Record<Hit['kind'], string> = { wiki: 'Wiki', meeting: 'Meeting', slack: 'Slack' };

// The line the caret is on, so long notes match on what is being written now.
export const caretLine = (el: HTMLTextAreaElement) => {
  const v = el.value, at = el.selectionStart ?? v.length;
  const end = v.indexOf('\n', at);
  return v.slice(v.lastIndexOf('\n', at - 1) + 1, end < 0 ? v.length : end);
};

// The field keeps focus on press; a click blurs it first so its edit saves before the page changes.
const keep = (e: React.MouseEvent) => e.preventDefault();
const leave = (go: () => void) => () => { (document.activeElement as HTMLElement | null)?.blur(); go(); };

// Up to three wiki claims, past meetings and Slack chats that match what is being typed.
export function RelatedStrip({ text, profile, skip = '' }: { text: string; profile: string; skip?: string }) {
  const snap = useAssistantData();
  const { meetings } = useCodex();
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(text), WAIT);
    return () => clearTimeout(t);
  }, [text]);
  const hits = useMemo(() => related({ items: snap.items, meetings, facts: snap.facts, pages: snap.pages }, query, profile, [skip]), [query, profile, skip, snap.items, meetings, snap.facts, snap.pages]);
  if (!hits.length) return null;
  return (
    <div className="as-related" role="list" aria-label="Related">
      {hits.map((h) => {
        const body = <><Icon name={ICON[h.kind]} small /><span className="sr-only">{KIND[h.kind]}: </span><span className="as-related-title">{h.title}</span>{h.kind === 'meeting' && h.at > 0 && <span className="as-related-when">{dayLabel(h.at)}</span>}</>;
        return <span key={h.kind + h.id} role="listitem" className="as-related-item">{h.kind === 'slack'
          ? <a className="as-related-hit" href={safeHref(h.url)} target="_blank" rel="noreferrer" onMouseDown={keep}>{body}</a>
          : <button className="as-related-hit" onMouseDown={keep}
            onClick={leave(() => (h.kind === 'meeting' ? openMeeting(h) : setView({ list: 'wiki', open: h.page ?? MEMORY, anchor: h.id, person: null })))}>{body}</button>}</span>;
      })}
    </div>
  );
}
