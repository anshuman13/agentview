import { useMemo, useState } from 'react';
import { useAssistantStore, useCodex } from '../data';
import { ask, wikiAskText } from '../data/ask';
import { currentClaim, factTime, live, needsReview, newPage, NO_STATS, proposedPageIds, searchWiki, statsByPage, type Fact, type Page, type PageStats } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/Panel';
import { MenuItem, MenuSeparator } from '../../ui/Menu';
import { Section } from '../../ui/Section';
import { ShowMore, useWindow } from '../../ui/useWindow';
import { CardRow } from '../overview/CardRow';
import { setView, showSnack, useFocusBack, useSpotBack } from '../view';
import { AskBar } from './AskBar';
import { Feed } from './Feed';
import { Notes } from './Notes';
import { PageTile } from './PageTile';
import { NeedsLook, ToReview } from './Review';
import { usePullSync } from '../pullSync';
import { MEMORY, shortDate } from './shared';
import { plural } from '../../ui/util';

const SECTION_ORDER = ['Teams', 'Projects', 'People', 'Practices'];

function sections(pages: Page[]) {
  const rest = live(pages).filter((p) => p.section !== 'overview');
  const names = [...new Set(rest.map((p) => p.section || 'Pages'))].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a), ib = SECTION_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return names.map((name) => ({ name, pages: rest.filter((p) => (p.section || 'Pages') === name).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)) }));
}

function Overview({ page, facts, pages }: { page: Page; facts: Fact[]; pages: Page[] }) {
  const current = useMemo(() => live(facts).filter(currentClaim(facts)), [facts]);
  const contested = current.filter((f) => f.contested).length;
  const updated = Math.max(page.updated_at, ...current.map(factTime));
  return (
    <button className="wk-overview" onClick={() => setView({ open: page.id, anchor: null })}>
      <span className="wk-overview-mark"><Icon name="organization" /></span>
      <span className="wk-overview-body">
        <span className="wk-overview-title">{page.title}</span>
        <span className="wk-overview-summary">{page.summary}</span>
        <span className="wk-meta">
          <span>{plural(live(pages).length, 'page')}</span>
          <span>{plural(current.length, 'claim')}</span>
          {contested > 0 && <span className="wk-warn">{contested} contested</span>}
          <span>updated {shortDate(updated)}</span>
        </span>
      </span>
      <Icon name="chevron-right" />
    </button>
  );
}

function PageCard({ page, stats }: { page: Page; stats: Map<string | null, PageStats> }) {
  const st = stats.get(page.id) ?? NO_STATS;
  return (
    <button className="wk-card" onClick={() => setView({ open: page.id, anchor: null })}>
      <PageTile page={page} />
      <span className="wk-card-title">{page.title}</span>
      <span className="wk-card-summary">{page.summary}</span>
      <span className="wk-card-foot">
        <span>{shortDate(Math.max(page.updated_at, st.updated))}</span>
        <span className="spacer" />
        {st.contested > 0 && <span className="wk-flag" title={`${st.contested} contested`}><Icon name="warning" small /> {st.contested}</span>}
        <span title="Claims">{plural(st.claims, 'claim')}</span>
      </span>
    </button>
  );
}

function PageRow({ page, stats, proposed }: { page: Page; stats: Map<string | null, PageStats>; proposed: Set<string | null> }) {
  const store = useAssistantStore();
  const st = stats.get(page.id) ?? NO_STATS;
  const open = () => setView({ open: page.id, anchor: null });
  const archive = () => {
    void store.editRow('pages', page, { state: 'retired' });
    showSnack(`Archived ${page.title}`, () => void store.editRow('pages', page, { state: null }));
  };
  return (
    <CardRow
      leading={<PageTile page={page} />}
      title={page.title}
      meta={`${page.section || 'Pages'} · ${plural(st.claims, 'claim')} · updated ${shortDate(Math.max(page.updated_at, st.updated))}`}
      badge={needsReview(page, proposed) ? { label: 'Needs review', tone: 'waiting' } : undefined}
      onOpen={open}
      menu={(choose) => (
        <>
          <MenuItem icon="file" onClick={choose(open)}>Open</MenuItem>
          <MenuSeparator />
          <MenuItem icon="archive" danger onClick={choose(archive)}>Archive</MenuItem>
        </>
      )}
    />
  );
}

function NewPageCard({ section, sort }: { section: string; sort: number }) {
  const store = useAssistantStore();
  const [title, setTitle] = useState<string | null>(null);
  const card = useFocusBack<HTMLButtonElement>(title !== null);
  const create = () => {
    const t = title?.trim();
    setTitle(null);
    if (!t) return;
    const page = newPage(t, section, sort);
    void store.editRow('pages', page, {});
    setView({ open: page.id, anchor: null });
  };
  if (title === null) return <button ref={card} className="wk-card wk-new" onClick={() => setTitle('')}><Icon name="add" /> New page</button>;
  return (
    <div className="wk-card wk-new editing">
      <input autoFocus enterKeyHint="done" value={title} placeholder="Page title" aria-label="Page title" onChange={(e) => setTitle(e.target.value)} onBlur={create}
        onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setTitle(null); }} />
      <span className="wk-card-summary">Claims about it are added as meetings, Slack and Linear mention it.</span>
    </div>
  );
}

function Results({ pages, facts, stats, query }: { pages: Page[]; facts: Fact[]; stats: Map<string | null, PageStats>; query: string }) {
  const r = useMemo(() => searchWiki(pages, facts, query), [pages, facts, query]);
  const [n, more] = useWindow(query);
  const title = new Map(pages.map((p) => [p.id, p.title]));
  if (!r.pages.length && !r.claims.length) return <EmptyState size="sm" icon="search" title={`Nothing in the wiki matches “${query}”`} hint="Ask the wiki below to search Slack and Linear too" />;
  return (
    <>
      {r.pages.length > 0 && (
        <section>
          <div className="wk-label">Pages</div>
          <div className="wk-cards">{r.pages.map((p) => <PageCard key={p.profile + p.id} page={p} stats={stats} />)}</div>
        </section>
      )}
      {r.claims.length > 0 && (
        <section>
          <div className="wk-label">Claims · {r.claims.length}</div>
          <div className="wk-hits">
            {r.claims.slice(0, n).map((f) => (
              <button key={f.profile + f.id} className="wk-hit" onClick={() => setView({ open: f.page_id ?? MEMORY, anchor: f.id })}>
                <span className="wk-feed-page">{f.page_id ? title.get(f.page_id) : 'Memory'}</span>
                <span className="wk-hit-text">{f.text}</span>
              </button>
            ))}
          </div>
          <ShowMore shown={n} total={r.claims.length} onMore={more} />
        </section>
      )}
    </>
  );
}

function MemoryCard({ stats }: { stats: Map<string | null, PageStats> }) {
  const st = stats.get(null) ?? NO_STATS;
  if (!st.claims) return null;
  return (
    <button className="wk-card" onClick={() => setView({ open: MEMORY, anchor: null })}>
      <span className="wk-tile amber"><Icon name="lightbulb" /></span>
      <span className="wk-card-title">Memory</span>
      <span className="wk-card-summary">What Claude remembers outside the pages.</span>
      <span className="wk-card-foot"><span>{shortDate(st.updated)}</span><span className="spacer" /><span>{plural(st.claims, 'claim')}</span></span>
    </button>
  );
}

export function WikiIndex({ onMenu }: { onMenu: () => void }) {
  const pull = usePullSync();
  useSpotBack(pull.ref, 'wiki');
  const { pages, facts } = useCodex();
  const [query, setQuery] = useState('');
  const overview = useMemo(() => live(pages).find((p) => p.section === 'overview'), [pages]);
  const groups = useMemo(() => sections(pages), [pages]);
  const stats = useMemo(() => statsByPage(facts), [facts]);
  const proposed = useMemo(() => proposedPageIds(facts), [facts]);
  return (
    <div className="wk">
      <header className="wk-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
        <h1>Wiki</h1>
        <span className="spacer" />
        <label className="wk-search">
          <Icon name="search" small />
          <input enterKeyHint="search" value={query} placeholder="Search" aria-label="Search the wiki" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
          {query && <button className="icon-btn" aria-label="Clear" onClick={() => setQuery('')}><Icon name="close" small /></button>}
        </label>
      </header>
      {pull.indicator}
      <div className="wk-scroll" ref={pull.ref}>
        <div className="wk-index">
          <div className="wk-main">
            {query.trim() ? <><Results pages={pages} facts={facts} stats={stats} query={query} /><Notes query={query} /></> : (
              <>
                <ToReview facts={facts} />
                {overview && <Overview page={overview} facts={facts} pages={pages} />}
                {(groups.length ? groups : [{ name: 'Pages', pages: [] as Page[] }]).map((s, i) => (
                  <section key={s.name}>
                    {s.pages.length > 0 && (
                      <>
                        <Section label={s.name} count={s.pages.length} />
                        <div className="as-group ov-queue-group">
                          {s.pages.map((p) => <PageRow key={p.profile + p.id} page={p} stats={stats} proposed={proposed} />)}
                        </div>
                      </>
                    )}
                    {!s.pages.length && <div className="wk-label">{s.name}</div>}
                    <div className="wk-cards">
                      {i === 0 && <MemoryCard stats={stats} />}
                      <NewPageCard section={s.name} sort={Math.max(0, ...s.pages.map((p) => p.sort ?? 0)) + 1} />
                    </div>
                  </section>
                ))}
                <NeedsLook />
                <Notes query="" />
              </>
            )}
          </div>
          <Feed pages={pages} facts={facts} />
        </div>
      </div>
      <AskBar placeholder="Ask the wiki" onAsk={(q) => ask(wikiAskText(q, pages, facts), 'work')} />
    </div>
  );
}
