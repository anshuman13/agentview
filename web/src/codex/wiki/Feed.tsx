import { useMemo, useState } from 'react';
import { contestOf, currentClaim, factTime, live, sourcesOf, type Fact, type Page } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { ago } from '../../ui/util';
import { setView } from '../view';
import { MEMORY, SOURCE_ICON } from './shared';

type FeedKind = 'added' | 'updated' | 'contested';

export function Feed({ pages, facts }: { pages: Page[]; facts: Fact[] }) {
  const [onlyContested, setOnly] = useState(false);
  const entries = useMemo(() => {
    const replaced = new Set(facts.map((f) => f.superseded_by).filter(Boolean));
    return live(facts)
      .filter(currentClaim(facts))
      .map((f) => ({ fact: f, kind: (f.contested ? 'contested' : replaced.has(f.id) ? 'updated' : 'added') as FeedKind, at: factTime(f) }))
      .sort((a, b) => b.at - a.at);
  }, [facts]);
  const title = new Map(pages.map((p) => [p.id, p.title]));
  const contested = entries.filter((e) => e.kind === 'contested').length;
  const shown = (onlyContested ? entries.filter((e) => e.kind === 'contested') : entries).slice(0, 10);
  const label: Record<FeedKind, string> = { added: 'New', updated: 'Updated', contested: 'Contested' };
  return (
    <aside className="wk-feed">
      <div className="wk-feed-head">
        <span className="wk-label">Recently updated</span>
        {contested > 0 && (
          <button className={`wk-pill${onlyContested ? ' on' : ''}`} onClick={() => setOnly((v) => !v)} title="Show only contested claims">
            <Icon name="warning" small /> {contested} contested
          </button>
        )}
      </div>
      {!shown.length && <p className="mt-pending">No claims yet.</p>}
      <ol className="wk-feed-list">
        {shown.map(({ fact, kind, at }) => {
          const src = sourcesOf(fact)[0];
          const c = contestOf(fact);
          return (
            <li key={fact.profile + fact.id} className={kind}>
              <button onClick={() => setView({ open: fact.page_id ?? MEMORY, anchor: fact.id })}>
                <span className="wk-feed-top"><span className="wk-feed-kind">{label[kind]}</span><span className="wk-feed-page">{fact.page_id ? title.get(fact.page_id) : 'Memory'}</span></span>
                <span className="wk-feed-text">{fact.text}</span>
                <span className="wk-meta">
                  {kind === 'contested' && c ? <span>by {c.by}</span> : src && <span><Icon name={SOURCE_ICON[src.kind]} small /> {src.label}</span>}
                  <span>{ago(at, ' ago')}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
