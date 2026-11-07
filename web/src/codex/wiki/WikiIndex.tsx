import { useMemo, useState, type ReactNode } from 'react';
import { useAssistantStore, useCodex } from '../data';
import { ask, wikiAskText } from '../data/ask';
import { live, needsReview, newPage, NO_STATS, proposedPageIds, searchWiki, statsByPage, type Fact, type Page, type PageStats } from '../data/wiki';
import { Back } from '../../app/back';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/Panel';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { Section, sectionCount } from '../../ui/Section';
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
import { plural, useEscape } from '../../ui/util';
import { useSheetDrag } from '../../ui/useSheetDrag';

const SECTION_ORDER = ['Teams', 'Projects', 'People', 'Practices'];

function sections(pages: Page[]) {
  const rest = live(pages).filter((p) => p.section !== 'overview');
  const names = [...new Set(rest.map((p) => p.section || 'Pages'))].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a), ib = SECTION_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return names.map((name) => ({ name, pages: rest.filter((p) => (p.section || 'Pages') === name).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)) }));
}

export function Overview({ page }: { page: Page }) {
  return (
    <button className="wk-overview" onClick={() => setView({ open: page.id, anchor: null })}>
      <span className="wk-overview-mark"><Icon name="organization" /></span>
      <span className="wk-overview-body">
        <span className="wk-overview-title">{page.title}</span>
        <span className="wk-overview-summary">{page.summary}</span>
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

export function PageRow({ page, proposed }: { page: Page; proposed: Set<string | null> }) {
  const store = useAssistantStore();
  const open = () => setView({ open: page.id, anchor: null });
  const archive = () => {
    void store.editRow('pages', page, { state: 'retired' });
    showSnack(`Archived ${page.title}`, () => void store.editRow('pages', page, { state: null }));
  };
  return (
    <CardRow
      leading={<PageTile page={page} />}
      title={page.title}
      badge={needsReview(page, proposed) ? { status: 'waiting', label: 'Needs you', reason: 'Needs review' } : undefined}
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

function NewPageField({ sort, onDone }: { sort: number; onDone: () => void }) {
  const store = useAssistantStore();
  const [title, setTitle] = useState('');
  const create = () => {
    const t = title.trim();
    onDone();
    if (!t) return;
    const page = newPage(t, 'Pages', sort);
    void store.editRow('pages', page, {});
    setView({ open: page.id, anchor: null });
  };
  return (
    <div className="wk-card wk-new editing">
      <input autoFocus enterKeyHint="done" value={title} placeholder="Page title" aria-label="Page title" onChange={(e) => setTitle(e.target.value)} onBlur={create}
        onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') onDone(); }} />
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
          <Section label="Pages" count={sectionCount(r.pages.length)} />
          <div className="wk-cards">{r.pages.map((p) => <PageCard key={p.profile + p.id} page={p} stats={stats} />)}</div>
        </section>
      )}
      {r.claims.length > 0 && (
        <section>
          <Section label="Claims" count={sectionCount(r.claims.length)} />
          <div className="ui-group">
            {r.claims.slice(0, n).map((f) => (
              <Row key={f.profile + f.id} lines={2} title={f.text} meta={f.page_id ? title.get(f.page_id) : 'Memory'} onClick={() => setView({ open: f.page_id ?? MEMORY, anchor: f.id })} />
            ))}
          </div>
          <ShowMore shown={n} total={r.claims.length} onMore={more} />
        </section>
      )}
    </>
  );
}

function WikiSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const sheet = useSheetDrag(true, onClose);
  useEscape(sheet.close);
  return (
    <div className="as-sheet-overlay" ref={sheet.overlay} onClick={sheet.close}>
      <Back close={onClose} />
      <div className="as-sheet" ref={sheet.sheet} role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" {...sheet.handle} />
        {children}
      </div>
    </div>
  );
}

export function WikiIndex({ onMenu }: { onMenu: () => void }) {
  const pull = usePullSync();
  useSpotBack(pull.ref, 'wiki');
  const { pages, facts } = useCodex();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<'Feed' | 'Notes' | 'Ask' | null>(null);
  const add = useFocusBack<HTMLButtonElement>(adding);
  const more = useFocusBack<HTMLButtonElement>(sheet !== null);
  const overview = useMemo(() => live(pages).find((p) => p.section === 'overview'), [pages]);
  const groups = useMemo(() => sections(pages), [pages]);
  const stats = useMemo(() => statsByPage(facts), [facts]);
  const proposed = useMemo(() => proposedPageIds(facts), [facts]);
  const sort = Math.max(0, ...(groups.find((g) => g.name === 'Pages')?.pages ?? []).map((p) => p.sort ?? 0)) + 1;
  const choose = (s: 'Feed' | 'Notes' | 'Ask') => () => { setMenu(false); setSheet(s); };
  const newPageButton = <Button size="sm" variant="tinted" onClick={() => setAdding(true)}>New page</Button>;
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
        <IconButton ref={add} size="sm" icon="add" label="New page" disabled={adding} onClick={() => setAdding(true)} />
        <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
        {menu && (
          <Menu trigger={more} onClose={() => setMenu(false)}>
            <MenuItem icon="history" onClick={choose('Feed')}>Feed</MenuItem>
            <MenuItem icon="note" onClick={choose('Notes')}>Notes</MenuItem>
            <MenuItem icon="sparkle" onClick={choose('Ask')}>Ask</MenuItem>
          </Menu>
        )}
      </header>
      {pull.indicator}
      <div className="wk-scroll" ref={pull.ref}>
        <div className="wk-index">
          <div className="wk-main">
            {adding && <NewPageField sort={sort} onDone={() => setAdding(false)} />}
            {query.trim() ? <><Results pages={pages} facts={facts} stats={stats} query={query} /><Notes query={query} /></> : (
              <>
                <ToReview facts={facts} />
                {overview && <Overview page={overview} />}
                {groups.length ? groups.map((s) => (
                  <section key={s.name}>
                    <Section label={s.name} count={s.pages.length} />
                    <div className="as-group ov-queue-group">
                      {s.pages.map((p) => <PageRow key={p.profile + p.id} page={p} proposed={proposed} />)}
                    </div>
                  </section>
                )) : !adding && <EmptyState size="sm" icon="book" title="No pages yet" action={newPageButton} />}
                <NeedsLook />
              </>
            )}
          </div>
        </div>
      </div>
      {sheet && (
        <WikiSheet label={sheet} onClose={() => setSheet(null)}>
          {sheet === 'Feed' && <Feed pages={pages} facts={facts} />}
          {sheet === 'Notes' && <Notes query="" />}
          {sheet === 'Ask' && <AskBar placeholder="Ask the wiki" onAsk={(q) => { const ok = ask(wikiAskText(q, pages, facts), 'work'); if (ok) setSheet(null); return ok; }} />}
        </WikiSheet>
      )}
    </div>
  );
}
