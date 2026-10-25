import { useMemo, useState } from 'react';
import { useCodex } from '../../assistant';
import { ask, wikiAskText } from '../../assistant/ask';
import { contestOf, factTime, live, pageStats, sourcesOf, type Fact, type Page, type Source } from '../../assistant/wiki';
import { Icon } from '../../Icon';
import { ago } from '../util';
import { setView, useView } from './view';
import '../../styles/features/wiki.css';

export const SOURCE_ICON: Record<Source['kind'], string> = { meeting: 'record', slack: 'comment-discussion', linear: 'issues', pr: 'git-pull-request', doc: 'file' };
const SECTION_ORDER = ['Teams', 'Projects', 'People', 'Practices'];

export function shortDate(t: number, now = Date.now()) {
  if (now - t < 24 * 3600_000) return ago(t, ' ago');
  if (now - t < 48 * 3600_000) return 'yesterday';
  const d = new Date(t);
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(now).getFullYear() && { year: 'numeric' }) });
}

function sections(pages: Page[]) {
  const rest = live(pages).filter((p) => p.section !== 'overview');
  const names = [...new Set(rest.map((p) => p.section || 'Pages'))].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a), ib = SECTION_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return names.map((name) => ({ name, pages: rest.filter((p) => (p.section || 'Pages') === name).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)) }));
}

function Overview({ page, facts, pages }: { page: Page; facts: Fact[]; pages: Page[] }) {
  const current = live(facts).filter((f) => !f.superseded_by);
  const contested = current.filter((f) => f.contested).length;
  const updated = Math.max(page.updated_at, ...current.map(factTime));
  return (
    <button className="wk-overview" onClick={() => setView({ open: page.id, anchor: null })}>
      <span className="wk-overview-mark"><Icon name="organization" /></span>
      <span className="wk-overview-body">
        <span className="wk-overview-title">{page.title}</span>
        <span className="wk-overview-summary">{page.summary}</span>
        <span className="wk-meta">
          <span>{live(pages).length} pages</span>
          <span>{current.length} claims</span>
          {contested > 0 && <span className="wk-warn">{contested} contested</span>}
          <span>updated {shortDate(updated)}</span>
        </span>
      </span>
      <Icon name="chevron-right" />
    </button>
  );
}

function PageCard({ page, facts }: { page: Page; facts: Fact[] }) {
  const st = pageStats(facts, page.id);
  return (
    <button className="wk-card" onClick={() => setView({ open: page.id, anchor: null })}>
      <span className="wk-card-title">{page.title}</span>
      <span className="wk-card-summary">{page.summary}</span>
      <span className="wk-card-foot">
        <span>{shortDate(Math.max(page.updated_at, st.updated))}</span>
        <span className="spacer" />
        {st.contested > 0 && <span className="wk-flag" title={`${st.contested} contested`}><Icon name="warning" small /> {st.contested}</span>}
        <span title="Claims">{st.claims} claims</span>
      </span>
    </button>
  );
}

type FeedKind = 'added' | 'updated' | 'contested';

export function Feed({ pages, facts }: { pages: Page[]; facts: Fact[] }) {
  const [onlyContested, setOnly] = useState(false);
  const entries = useMemo(() => {
    const replaced = new Set(facts.map((f) => f.superseded_by).filter(Boolean));
    return live(facts)
      .filter((f) => !f.superseded_by)
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
      <ol className="wk-feed-list">
        {shown.map(({ fact, kind, at }) => {
          const src = sourcesOf(fact)[0];
          const c = contestOf(fact);
          return (
            <li key={fact.profile + fact.id} className={kind}>
              <button onClick={() => setView({ open: fact.page_id, anchor: fact.id })}>
                <span className="wk-feed-top"><span className="wk-feed-kind">{label[kind]}</span><span className="wk-feed-page">{title.get(fact.page_id ?? '')}</span></span>
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

export function AskBar({ placeholder, onAsk }: { placeholder: string; onAsk: (q: string) => boolean }) {
  const [q, setQ] = useState('');
  const submit = () => q.trim() && onAsk(q.trim()) && setQ('');
  return (
    <div className="wk-ask">
      <div className="wk-ask-box">
        <Icon name="sparkle" />
        <input value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()} />
        <button className="cp-send" aria-label="Ask" title="Ask in a new chat" disabled={!q.trim()} onClick={submit}><Icon name="arrow-up" /></button>
      </div>
    </div>
  );
}

function WikiIndex({ onMenu }: { onMenu: () => void }) {
  const { pages, facts, sample } = useCodex();
  const overview = live(pages).find((p) => p.section === 'overview');
  return (
    <div className="wk">
      <header className="wk-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
        <h1>Wiki</h1>
        {sample && <span className="wk-sample" title="The scheduler fills the wiki from meetings, Slack and Linear; until then this is sample data">Sample</span>}
        <span className="spacer" />
      </header>
      <div className="wk-scroll">
        <div className="wk-index">
          <div className="wk-main">
            {overview && <Overview page={overview} facts={facts} pages={pages} />}
            {sections(pages).map((s) => (
              <section key={s.name}>
                <div className="wk-label">{s.name}</div>
                <div className="wk-cards">{s.pages.map((p) => <PageCard key={p.profile + p.id} page={p} facts={facts} />)}</div>
              </section>
            ))}
          </div>
          <Feed pages={pages} facts={facts} />
        </div>
      </div>
      <AskBar placeholder="Ask the wiki" onAsk={(q) => ask(wikiAskText(q, pages, facts))} />
    </div>
  );
}

export function Wiki({ onMenu }: { onMenu: () => void }) {
  const { open } = useView();
  if (open) {
    return (
      <div className="wk">
        <header className="wk-head">
          <button className="icon-btn" title="Back" aria-label="Back" onClick={() => setView({ open: null, anchor: null })}><Icon name="arrow-left" /></button>
        </header>
      </div>
    );
  }
  return <WikiIndex onMenu={onMenu} />;
}
