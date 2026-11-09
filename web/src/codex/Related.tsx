import type { ItemRow } from './data/sync';
import { useEffect, useMemo, useState } from 'react';
import { useAssistantData, useCodex } from './data';
import { related, relatedToTask, type Related as Hit } from './data/ask/search';
import { dayLabel } from './data/dates';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
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

function RelatedList({ hits }: { hits: Hit[] }) {
  if (!hits.length) return null;
  return (
    <div className="as-rel" role="group" aria-label="Related">
      <Section label="Related" count={hits.length} />
      {hits.map((h) => {
        const common = {
          leading: <Icon name={ICON[h.kind]} small />,
          title: <><span className="sr-only">{KIND[h.kind]}: </span>{h.title}</>,
          meta: h.kind === 'meeting' && h.at > 0 ? dayLabel(h.at) : KIND[h.kind],
          onMouseDown: keep,
        };
        return h.kind === 'slack'
          ? <Row key={h.kind + h.id} {...common} href={safeHref(h.url)} />
          : <Row key={h.kind + h.id} {...common}
            onClick={leave(() => (h.kind === 'meeting' ? openMeeting(h) : setView({ list: 'wiki', open: h.page ?? MEMORY, anchor: h.id, person: null })))} />;
      })}
    </div>
  );
}

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
  return <RelatedList hits={hits} />;
}

// Past meetings and Slack chats that touched the saved task, shown without typing.
export function RelatedToTask({ row }: { row: ItemRow }) {
  const snap = useAssistantData();
  const { meetings } = useCodex();
  const { id, profile, title, people } = row;
  const hits = useMemo(() => relatedToTask({ items: snap.items, meetings }, { id, profile, title, people }), [id, profile, title, people, snap.items, meetings]);
  return <RelatedList hits={hits} />;
}
