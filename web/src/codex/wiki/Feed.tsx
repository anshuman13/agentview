import { useMemo } from 'react';
import { contestOf, currentClaim, factTime, live, sourcesOf, type Fact, type Page } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/Panel';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { ago } from '../../ui/util';
import { setView } from '../view';
import { MEMORY, SOURCE_ICON } from './shared';

type FeedKind = 'added' | 'updated' | 'contested';

export function Feed({ pages, facts }: { pages: Page[]; facts: Fact[] }) {
  const entries = useMemo(() => {
    const replaced = new Set(facts.map((f) => f.superseded_by).filter(Boolean));
    return live(facts)
      .filter(currentClaim(facts))
      .map((f) => ({ fact: f, kind: (f.contested ? 'contested' : replaced.has(f.id) ? 'updated' : 'added') as FeedKind, at: factTime(f) }))
      .sort((a, b) => b.at - a.at);
  }, [facts]);
  const title = new Map(pages.map((p) => [`${p.profile}:${p.id}`, p.title]));
  const shown = entries.slice(0, 5);
  return (
    <aside className="wk-feed">
      <Section label="Recently updated" />
      <div className="as-group">
        {!shown.length && <EmptyState size="sm" icon="book" title="No claims yet" />}
        {shown.map(({ fact, kind, at }) => {
          const src = sourcesOf(fact)[0];
          const c = contestOf(fact);
          const page = fact.page_id ? title.get(`${fact.profile}:${fact.page_id}`) : 'Memory';
          return (
            <Row
              key={fact.profile + fact.id}
              lines={2}
              title={fact.text}
              meta={<>{page} · {kind === 'contested' && c ? <>by {c.by} · </> : src && <><Icon name={SOURCE_ICON[src.kind]} small /> {src.label} · </>}{ago(at, ' ago')}</>}
              trailing={kind === 'contested' ? <span className="badge waiting">Contested</span> : undefined}
              onClick={() => setView({ open: fact.page_id ?? MEMORY, anchor: fact.id })}
            />
          );
        })}
      </div>
    </aside>
  );
}
