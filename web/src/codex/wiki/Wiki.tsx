import { useEffect, useMemo, useState } from 'react';
import { useAssistant, useCodex } from '../data';
import type { ItemRow } from '../data/sync';
import { ask, wikiAskText } from '../data/ask';
import { approveAllChanges, approveChanges, chatOf, contestOf, currentClaim, factTime, live, newPage, NO_STATS, pageClaims, pageStats, proposals, searchWiki, sourcesOf, statsByPage, type Fact, type Page, type PageStats, type Source } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { ago } from '../../ui/util';
import { setView, showSnack, useEscapeBack, useView } from '../view';
import '../../styles/features/wiki.css';

export const SOURCE_ICON: Record<Source['kind'], string> = { meeting: 'calendar', slack: 'comment-discussion', linear: 'issues', pr: 'git-pull-request', doc: 'file' };
const SECTION_ORDER = ['Teams', 'Projects', 'People', 'Practices'];
const MEMORY = 'memory';
const memoryPage = (facts: Fact[]): Page => ({ id: MEMORY, profile: 'work', version: 0, updated_at: Math.max(0, ...live(facts).filter((f) => !f.page_id).map(factTime)), deleted: 0, field_times: '{}', dirty: 0, title: 'Memory', section: null, summary: 'What Claude remembers about you and your work outside the wiki pages.', sort: 0, state: null });

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
  const current = live(facts).filter(currentClaim(facts));
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

function PageCard({ page, stats }: { page: Page; stats: Map<string | null, PageStats> }) {
  const st = stats.get(page.id) ?? NO_STATS;
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

// A loose note: a capture that is not a task. Tap to edit; the first line is its title.
function NoteCard({ row }: { row: ItemRow }) {
  const { store } = useAssistant();
  const full = [row.title ?? '', row.text ?? ''].filter(Boolean).join('\n');
  const [text, setText] = useState<string | null>(null);
  const save = () => {
    const t = text?.trim();
    setText(null);
    if (t == null || t === full) return;
    if (!t) return void store.update(row, { deleted: 1 });
    const [first, ...rest] = t.split('\n');
    void store.update(row, { title: first.slice(0, 120), text: rest.join('\n').trim() || null });
  };
  const remove = () => {
    void store.update(row, { deleted: 1 });
    showSnack('Note deleted', () => void store.update(row, { deleted: 0 }));
  };
  const toTask = () => {
    void store.update(row, { status: 'open' });
    showSnack('Moved to Today', () => void store.update(row, { status: 'note' }));
  };
  if (text !== null) {
    return (
      <div className="wk-card wk-note editing">
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Escape' && setText(null)} />
        <span className="wk-card-foot">
          <button className="btn sm" onMouseDown={(e) => e.preventDefault()} onClick={toTask}>Make task</button>
          <span className="spacer" />
          <button className="icon-btn" title="Delete" aria-label="Delete" onMouseDown={(e) => e.preventDefault()} onClick={remove}><Icon name="trash" small /></button>
        </span>
      </div>
    );
  }
  return (
    <button className="wk-card wk-note" onClick={() => setText(full)}>
      <span className="wk-card-title">{row.title || '(Untitled)'}</span>
      {row.text && <span className="wk-card-summary">{row.text}</span>}
      <span className="wk-card-foot"><span>{ago(row.updated_at, ' ago')}</span><span className="spacer" /><span>{row.profile === 'personal' ? 'Personal' : 'Work'}</span></span>
    </button>
  );
}

function NewNoteCard() {
  const { store } = useAssistant();
  const { filter } = useView();
  const [text, setText] = useState<string | null>(null);
  const create = () => {
    const t = text?.trim();
    setText(null);
    if (t) void store.capture(t, 'note', filter === 'personal' ? 'personal' : 'work');
  };
  if (text === null) return <button className="wk-card wk-new" onClick={() => setText('')}><Icon name="add" /> New note</button>;
  return (
    <div className="wk-card wk-new wk-note editing">
      <textarea autoFocus value={text} placeholder="First line is the title" onChange={(e) => setText(e.target.value)} onBlur={create} onKeyDown={(e) => e.key === 'Escape' && setText(null)} />
    </div>
  );
}

function Notes({ query }: { query: string }) {
  const { snap } = useAssistant();
  const { filter } = useView();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const notes = snap.items
    .filter((r) => !r.deleted && r.status === 'note' && (filter === 'all' || r.profile === filter))
    .filter((r) => words.every((w) => `${r.title ?? ''} ${r.text ?? ''}`.toLowerCase().includes(w)))
    .sort((a, b) => b.updated_at - a.updated_at);
  if (words.length && !notes.length) return null;
  return (
    <section>
      <div className="wk-label">Notes</div>
      <div className="wk-cards">
        {notes.map((r) => <NoteCard key={r.profile + r.id} row={r} />)}
        {!words.length && <NewNoteCard />}
      </div>
    </section>
  );
}

function NewPageCard({ section, sort }: { section: string; sort: number }) {
  const { store } = useCodex();
  const [title, setTitle] = useState<string | null>(null);
  const create = () => {
    const t = title?.trim();
    setTitle(null);
    if (!t) return;
    const page = newPage(t, section, sort);
    void store.editRow('pages', page, {});
    setView({ open: page.id, anchor: null });
  };
  if (title === null) return <button className="wk-card wk-new" onClick={() => setTitle('')}><Icon name="add" /> New page</button>;
  return (
    <div className="wk-card wk-new editing">
      <input autoFocus value={title} placeholder="Page title" onChange={(e) => setTitle(e.target.value)} onBlur={create}
        onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setTitle(null); }} />
      <span className="wk-card-summary">Claims about it are added as meetings, Slack and Linear mention it.</span>
    </div>
  );
}

function Results({ pages, facts, stats, query }: { pages: Page[]; facts: Fact[]; stats: Map<string | null, PageStats>; query: string }) {
  const r = useMemo(() => searchWiki(pages, facts, query), [pages, facts, query]);
  const title = new Map(pages.map((p) => [p.id, p.title]));
  if (!r.pages.length && !r.claims.length) return <div className="wk-none">Nothing in the wiki matches “{query}”. Ask the wiki below to search Slack and Linear too.</div>;
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
            {r.claims.map((f) => (
              <button key={f.profile + f.id} className="wk-hit" onClick={() => setView({ open: f.page_id ?? MEMORY, anchor: f.id })}>
                <span className="wk-feed-page">{f.page_id ? title.get(f.page_id) : 'Memory'}</span>
                <span className="wk-hit-text">{f.text}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ReviewCard({ fact }: { fact: Fact }) {
  const { store, pages, facts } = useCodex();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.text ?? '');
  const page = pages.find((p) => p.id === fact.page_id && p.profile === fact.profile);
  const old = facts.find((f) => f.id === fact.replaces && f.profile === fact.profile);
  const chat = chatOf(fact);
  const approve = () => {
    const changes = approveChanges(fact, pages, facts);
    changes.forEach((c) => void store.editRow(c.table, c.row as never, c.patch as never));
    showSnack('Approved', () => changes.forEach((c) => void store.editRow(c.table, c.row as never, c.undo as never)));
  };
  const reject = () => {
    void store.editRow('facts', fact, { state: 'rejected' });
    showSnack('Claim rejected', () => void store.editRow('facts', fact, { state: 'proposed' }));
  };
  const save = () => {
    void store.editRow('facts', fact, { text: text.trim() || fact.text });
    setEditing(false);
  };
  return (
    <div className="mt-action proposed wk-review">
      <div className="mt-action-kind">
        <Icon name={page ? 'book' : 'lightbulb'} small />
        {page ? <>{page.title}{page.state === 'proposed' && <em> (new page in {page.section})</em>}{fact.heading && <> · {fact.heading}</>}</> : 'Memory'}
        {fact.profile === 'personal' && <span className="wk-src">Personal</span>}
      </div>
      {editing ? (
        <div className="mt-action-edit"><textarea autoFocus rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="Claim" /></div>
      ) : (
        <div className="mt-action-title">{fact.text}</div>
      )}
      {old && <div className="wk-old"><s>{old.text}</s><span>Replaces</span></div>}
      <div className="wk-claim-foot">
        {sourcesOf(fact).map((s, i) => <SourceChip key={i} s={s} />)}
        {chat && <ClaudeChip chat={chat} />}
        {fact.at != null && <span className="wk-claim-date">{shortDate(fact.at)}</span>}
      </div>
      <div className="mt-action-foot">
        {editing ? (
          <>
            <span className="spacer" />
            <button className="btn" onClick={() => { setEditing(false); setText(fact.text ?? ''); }}>Cancel</button>
            <button className="btn primary" onClick={save}>Save</button>
          </>
        ) : (
          <>
            <button className="wk-act" onClick={() => { setText(fact.text ?? ''); setEditing(true); }}><Icon name="edit" small /> Edit</button>
            <span className="spacer" />
            <button className="icon-btn mt-reject" title="Reject" aria-label="Reject" onClick={reject}><Icon name="close" /></button>
            <button className="btn primary mt-approve" onClick={approve}><Icon name="check" small /> Approve</button>
          </>
        )}
      </div>
    </div>
  );
}

function useReview() {
  const { store, pages, facts } = useCodex();
  const run = (changes: { table: 'facts' | 'pages'; row: unknown; patch: unknown; undo: unknown }[], text: string) => {
    changes.forEach((c) => void store.editRow(c.table, c.row as never, c.patch as never));
    showSnack(text, () => changes.forEach((c) => void store.editRow(c.table, c.row as never, c.undo as never)));
  };
  return {
    approve: (list: Fact[]) => run(approveAllChanges(list, pages, facts), `Approved ${list.length} ${list.length === 1 ? 'claim' : 'claims'}`),
    reject: (list: Fact[]) => {
      const page = pages.find((p) => list.length && p.id === list[0].page_id && p.profile === list[0].profile && p.state === 'proposed');
      const rest = page && proposals(facts).every((f) => f.page_id !== page.id || list.includes(f));
      run([
        ...list.map((f) => ({ table: 'facts' as const, row: f, patch: { state: 'rejected' }, undo: { state: 'proposed' } })),
        ...(rest ? [{ table: 'pages' as const, row: page, patch: { state: 'rejected' }, undo: { state: 'proposed' } }] : []),
      ], `Rejected ${list.length} ${list.length === 1 ? 'claim' : 'claims'}`);
    },
  };
}

// One card per page with its proposed claims, so a new page is reviewed as a page; memory claims are reviewed one by one.
function PageReview({ page, list }: { page: Page; list: Fact[] }) {
  const review = useReview();
  const headings = [...new Set(list.map((f) => f.heading || 'Notes'))];
  const times = list.map((f) => f.at ?? 0).filter(Boolean);
  return (
    <div className="mt-action proposed wk-review">
      <div className="mt-action-kind"><Icon name="book" small />{page.state === 'proposed' ? `New page in ${page.section}` : 'Additions'}{page.profile === 'personal' && <span className="wk-src">Personal</span>}</div>
      <div className="mt-action-title"><button className="wk-review-open" onClick={() => setView({ open: page.id, anchor: null })}>{page.title} <Icon name="chevron-right" small /></button></div>
      {page.summary && <div className="mt-action-body">{page.summary}</div>}
      <div className="wk-meta">
        <span>{list.length} {list.length === 1 ? 'claim' : 'claims'}</span>
        <span>{headings.length} {headings.length === 1 ? 'heading' : 'headings'}</span>
        {times.length > 0 && <span>{shortDate(Math.min(...times))} to {shortDate(Math.max(...times))}</span>}
      </div>
      <div className="mt-action-foot">
        <button className="wk-act" onClick={() => setView({ open: page.id, anchor: null })}><Icon name="book" small /> Read and edit</button>
        <span className="spacer" />
        <button className="icon-btn mt-reject" title="Reject all" aria-label="Reject all" onClick={() => review.reject(list)}><Icon name="close" /></button>
        <button className="btn primary mt-approve" onClick={() => review.approve(list)}><Icon name="check" small /> Approve all</button>
      </div>
    </div>
  );
}

function ToReview({ facts }: { facts: Fact[] }) {
  const { pages } = useCodex();
  const list = proposals(facts);
  if (!list.length) return null;
  const byPage = new Map<string, Fact[]>();
  for (const f of list) if (f.page_id) byPage.set(f.page_id, [...(byPage.get(f.page_id) ?? []), f]);
  const loose = list.filter((f) => !f.page_id || !pages.some((p) => p.id === f.page_id && !p.deleted));
  return (
    <section>
      <div className="wk-label">To review · {list.length}</div>
      <div className="wk-reviews">
        {[...byPage].map(([id, fs]) => {
          const page = pages.find((p) => p.id === id && p.profile === fs[0].profile && !p.deleted);
          return page && <PageReview key={page.profile + id} page={page} list={fs} />;
        })}
        {loose.map((f) => <ReviewCard key={f.profile + f.id} fact={f} />)}
      </div>
    </section>
  );
}

function MemoryCard({ stats }: { stats: Map<string | null, PageStats> }) {
  const st = stats.get(null) ?? NO_STATS;
  if (!st.claims) return null;
  return (
    <button className="wk-card" onClick={() => setView({ open: MEMORY, anchor: null })}>
      <span className="wk-card-title"><Icon name="lightbulb" small /> Memory</span>
      <span className="wk-card-summary">What Claude remembers outside the pages.</span>
      <span className="wk-card-foot"><span>{shortDate(st.updated)}</span><span className="spacer" /><span>{st.claims} claims</span></span>
    </button>
  );
}

function WikiIndex({ onMenu }: { onMenu: () => void }) {
  const { pages, facts } = useCodex();
  const [query, setQuery] = useState('');
  const overview = live(pages).find((p) => p.section === 'overview');
  const stats = useMemo(() => statsByPage(facts), [facts]);
  return (
    <div className="wk">
      <header className="wk-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
        <h1>Wiki</h1>
        <span className="spacer" />
        <label className="wk-search">
          <Icon name="search" small />
          <input value={query} placeholder="Search" aria-label="Search the wiki" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
          {query && <button className="icon-btn" aria-label="Clear" onClick={() => setQuery('')}><Icon name="close" small /></button>}
        </label>
      </header>
      <div className="wk-scroll">
        <div className="wk-index">
          <div className="wk-main">
            {query.trim() ? <><Results pages={pages} facts={facts} stats={stats} query={query} /><Notes query={query} /></> : (
              <>
                <ToReview facts={facts} />
                {overview && <Overview page={overview} facts={facts} pages={pages} />}
                {(sections(pages).length ? sections(pages) : [{ name: 'Pages', pages: [] as Page[] }]).map((s, i) => (
                  <section key={s.name}>
                    <div className="wk-label">{s.name}</div>
                    <div className="wk-cards">
                      {s.pages.map((p) => <PageCard key={p.profile + p.id} page={p} stats={stats} />)}
                      {i === 0 && <MemoryCard stats={stats} />}
                      <NewPageCard section={s.name} sort={Math.max(0, ...s.pages.map((p) => p.sort ?? 0)) + 1} />
                    </div>
                  </section>
                ))}
                <Notes query="" />
              </>
            )}
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
  const body = <><Icon name={SOURCE_ICON[s.kind]} small /> <span className="wk-src-text">{s.label}</span></>;
  return s.url ? <a className="wk-src" href={s.url} target="_blank" rel="noreferrer">{body}</a> : <span className="wk-src">{body}</span>;
}

function ClaudeChip({ chat }: { chat: string }) {
  return <a className="wk-src" href={`/?session=${encodeURIComponent(chat)}`} title="Open the chat that proposed this"><Icon name="sparkle" small /> Claude</a>;
}

function Claim({ fact, old, page, flash }: { fact: Fact; old: Fact[]; page: string; flash: boolean }) {
  const { store } = useCodex();
  const review = useReview();
  const proposed = fact.state === 'proposed';
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
    <div className={`wk-claim${c ? ' contested' : ''}${proposed ? ' proposed' : ''}${flash ? ' flash' : ''}`} id={`claim-${fact.id}`}>
      <p className="wk-claim-text">{fact.text}</p>
      <div className="wk-claim-foot">
        {sourcesOf(fact).map((s, i) => <SourceChip key={i} s={s} />)}
        {chatOf(fact) && <ClaudeChip chat={chatOf(fact)!} />}
        {fact.at != null && <span className="wk-claim-date">{shortDate(fact.at)}</span>}
        <span className="spacer" />
        <span className="wk-claim-acts">
          {proposed ? (
            <>
              <span className="wk-proposed">Proposed</span>
              <button className="icon-btn mt-reject" title="Reject" aria-label="Reject" onClick={() => review.reject([fact])}><Icon name="close" small /></button>
              <button className="icon-btn" title="Approve" aria-label="Approve" onClick={() => review.approve([fact])}><Icon name="check" small /></button>
            </>
          ) : <button className="icon-btn" title="Copy as a citation" aria-label="Copy as a citation" onClick={cite}><Icon name="link" small /></button>}
          {!proposed && !c && !contesting && <button className="wk-act" title="Say this claim is wrong or out of date" onClick={() => setContesting(true)}><Icon name="report" small /> Contest</button>}
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
  const { pages, facts } = useCodex();
  const { anchor } = useView();
  const [flash, setFlash] = useState<string | null>(null);
  const pid = id === MEMORY ? null : id;
  const page = id === MEMORY ? memoryPage(facts) : pages.find((p) => p.id === id && !p.deleted && p.state !== 'rejected');
  const review = useReview();
  const pending = proposals(facts).filter((f) => (f.page_id ?? null) === pid);
  useEffect(() => {
    if (!anchor) return;
    document.getElementById(`claim-${anchor}`)?.scrollIntoView({ block: 'center' });
    setFlash(anchor);
    setView({ anchor: null });
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [anchor]);
  const groups = useMemo(() => pageClaims(facts, pid), [facts, pid]);
  const st = pageStats(facts, pid);
  const counts = useMemo(() => {
    const n = new Map<Source['kind'], Set<string>>();
    for (const g of groups) for (const { fact } of g.claims) for (const s of sourcesOf(fact)) n.set(s.kind, (n.get(s.kind) ?? new Set()).add(s.label));
    return [...n].map(([kind, set]) => ({ kind, n: set.size }));
  }, [groups]);
  const back = () => setView({ open: null, anchor: null });
  useEscapeBack(back);
  const section = page?.section === 'overview' ? null : page?.section;
  return (
    <div className="wk">
      <header className="wk-head">
        <button className="icon-btn" title="Back to the wiki" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Wiki</button>{section && <><Icon name="chevron-right" small /><span>{section}</span></>}</nav>
        <span className="spacer" />
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
              {pending.length > 0 && (
                <div className="wk-pending">
                  <span>{page.state === 'proposed' ? 'New page with ' : ''}{pending.length} proposed {pending.length === 1 ? 'claim' : 'claims'}</span>
                  <span className="spacer" />
                  <button className="btn" onClick={() => review.reject(pending)}>Reject all</button>
                  <button className="btn primary" onClick={() => review.approve(pending)}><Icon name="check" small /> Approve all</button>
                </div>
              )}
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
      {page && pid && <AskBar placeholder={`Ask about ${page.title}`} onAsk={(q) => ask(wikiAskText(q, pages, facts, id))} />}
    </div>
  );
}

export function Wiki({ onMenu }: { onMenu: () => void }) {
  const { open } = useView();
  return open ? <WikiPage id={open} /> : <WikiIndex onMenu={onMenu} />;
}
