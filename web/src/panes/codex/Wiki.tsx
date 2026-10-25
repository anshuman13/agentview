import { useEffect, useMemo, useState } from 'react';
import { useCodex } from '../../assistant';
import { ask, wikiAskText } from '../../assistant/ask';
import { contestOf, factTime, live, pageClaims, pageStats, sourcesOf, type Fact, type Page, type Source } from '../../assistant/wiki';
import { Icon } from '../../Icon';
import { ago } from '../util';
import { setView, showSnack, useView } from './view';
import '../../styles/features/wiki.css';

export const SOURCE_ICON: Record<Source['kind'], string> = { meeting: 'calendar', slack: 'comment-discussion', linear: 'issues', pr: 'git-pull-request', doc: 'file' };
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

const SOURCE_NAME: Record<Source['kind'], [string, string]> = { meeting: ['meeting', 'meetings'], slack: ['Slack thread', 'Slack threads'], linear: ['Linear issue', 'Linear issues'], pr: ['pull request', 'pull requests'], doc: ['doc', 'docs'] };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function SourceChip({ s }: { s: Source }) {
  const body = <><Icon name={SOURCE_ICON[s.kind]} small /> {s.label}</>;
  return s.url ? <a className="wk-src" href={s.url} target="_blank" rel="noreferrer">{body}</a> : <span className="wk-src">{body}</span>;
}

function Claim({ fact, old, page, flash }: { fact: Fact; old: Fact[]; page: string; flash: boolean }) {
  const { store } = useCodex();
  const [contesting, setContesting] = useState(false);
  const [note, setNote] = useState('');
  const c = contestOf(fact);
  const contest = () => {
    void store.editRow('facts', fact, { contested: JSON.stringify({ by: 'you', at: Date.now(), note: note.trim() }) });
    setContesting(false);
    setNote('');
    showSnack('Claim contested', () => void store.editRow('facts', fact, { contested: null }));
  };
  const resolve = () => {
    void store.editRow('facts', fact, { contested: null });
    showSnack('Marked as resolved', () => void store.editRow('facts', fact, { contested: fact.contested }));
  };
  const cite = () => {
    const srcs = sourcesOf(fact).map((s) => s.label);
    const text = `${page}: ${fact.text}${srcs.length ? ` (${srcs.join(', ')}${fact.at ? `, ${shortDate(fact.at)}` : ''})` : ''}`;
    navigator.clipboard?.writeText(text).then(() => showSnack('Claim copied'), () => showSnack('Could not copy'));
  };
  return (
    <div className={`wk-claim${c ? ' contested' : ''}${flash ? ' flash' : ''}`} id={`claim-${fact.id}`}>
      <p className="wk-claim-text">{fact.text}</p>
      <div className="wk-claim-foot">
        {sourcesOf(fact).map((s, i) => <SourceChip key={i} s={s} />)}
        {fact.at != null && <span className="wk-claim-date">{shortDate(fact.at)}</span>}
        <span className="spacer" />
        <span className="wk-claim-acts">
          <button className="icon-btn" title="Copy as a citation" aria-label="Copy as a citation" onClick={cite}><Icon name="link" small /></button>
          {!c && !contesting && <button className="wk-act" title="Say this claim is wrong or out of date" onClick={() => setContesting(true)}><Icon name="report" small /> Contest</button>}
        </span>
      </div>
      {contesting && (
        <div className="wk-contest-form">
          <textarea autoFocus rows={2} value={note} placeholder="What is wrong or out of date? Link a source if you have one." onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setContesting(false); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) contest(); }} />
          <div className="wk-contest-btns">
            <button className="btn" onClick={() => setContesting(false)}>Cancel</button>
            <button className="btn primary" onClick={contest}>Contest</button>
          </div>
        </div>
      )}
      {c && (
        <div className="wk-contest">
          <div className="wk-contest-head">
            <Icon name="warning" small /> Contested by {c.by} · {ago(c.at, ' ago')}
            <span className="spacer" />
            <button className="wk-act" title="The claim is right, or the agent has replaced it" onClick={resolve}><Icon name="check" small /> Resolve</button>
          </div>
          {c.note && <div className="wk-contest-note">{c.note}</div>}
        </div>
      )}
      {old.map((o) => (
        <div key={o.id} className="wk-old">
          <s>{o.text}</s>
          <span>Replaced {o.at != null ? shortDate(o.at) : ''}</span>
        </div>
      ))}
    </div>
  );
}

function WikiPage({ id }: { id: string }) {
  const { pages, facts, sample } = useCodex();
  const { anchor } = useView();
  const [flash, setFlash] = useState<string | null>(null);
  const page = live(pages).find((p) => p.id === id);
  useEffect(() => {
    if (!anchor) return;
    document.getElementById(`claim-${anchor}`)?.scrollIntoView({ block: 'center' });
    setFlash(anchor);
    setView({ anchor: null });
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [anchor]);
  const groups = useMemo(() => pageClaims(facts, id), [facts, id]);
  const st = pageStats(facts, id);
  const counts = useMemo(() => {
    const n = new Map<Source['kind'], Set<string>>();
    for (const g of groups) for (const { fact } of g.claims) for (const s of sourcesOf(fact)) n.set(s.kind, (n.get(s.kind) ?? new Set()).add(s.label));
    return [...n].map(([kind, set]) => ({ kind, n: set.size }));
  }, [groups]);
  const back = () => setView({ open: null, anchor: null });
  const section = page?.section === 'overview' ? null : page?.section;
  return (
    <div className="wk">
      <header className="wk-head">
        <button className="icon-btn" title="Back to the wiki" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Wiki</button>{section && <><Icon name="chevron-right" small /><span>{section}</span></>}</nav>
        <span className="spacer" />
        {sample && <span className="wk-sample" title="Sample data until the scheduler fills the wiki">Sample</span>}
      </header>
      <div className="wk-scroll">
        {!page ? (
          <div className="as-empty"><Icon name="book" /><div>This page is gone.</div><button className="btn" onClick={back}>Back to the wiki</button></div>
        ) : (
          <div className="wk-doc">
            <article className="wk-article">
              <h1 className="wk-title">{page.title}</h1>
              {page.summary && <p className="wk-lede">{page.summary}</p>}
              <div className="wk-meta wk-page-meta">
                <span>Updated {shortDate(Math.max(page.updated_at, st.updated))}</span>
                <span>{st.claims} claims</span>
                {st.contested > 0 && <span className="wk-warn">{st.contested} contested</span>}
              </div>
              {groups.map((g) => (
                <section key={g.heading} id={`h-${slug(g.heading)}`} className="wk-group">
                  <h2>{g.heading}</h2>
                  {g.claims.map(({ fact, old }) => <Claim key={fact.profile + fact.id} fact={fact} old={old} page={page.title ?? ''} flash={flash === fact.id} />)}
                </section>
              ))}
              {!groups.length && <div className="wk-none">No claims yet. They appear here as meetings, Slack threads and issues mention {page.title}.</div>}
            </article>
            <aside className="wk-rail">
              {groups.length > 1 && (
                <div className="wk-rail-block">
                  <div className="wk-label">On this page</div>
                  {groups.map((g) => <a key={g.heading} href={`#h-${slug(g.heading)}`} onClick={(e) => { e.preventDefault(); document.getElementById(`h-${slug(g.heading)}`)?.scrollIntoView({ behavior: 'smooth' }); }}>{g.heading}</a>)}
                </div>
              )}
              {counts.length > 0 && (
                <div className="wk-rail-block">
                  <div className="wk-label">Sources</div>
                  {counts.map(({ kind, n }) => <span key={kind} className="wk-rail-src"><Icon name={SOURCE_ICON[kind]} small /> {n} {SOURCE_NAME[kind][n === 1 ? 0 : 1]}</span>)}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
      {page && <AskBar placeholder={`Ask about ${page.title}`} onAsk={(q) => ask(wikiAskText(q, pages, facts, id))} />}
    </div>
  );
}

export function Wiki({ onMenu }: { onMenu: () => void }) {
  const { open } = useView();
  return open ? <WikiPage id={open} /> : <WikiIndex onMenu={onMenu} />;
}
