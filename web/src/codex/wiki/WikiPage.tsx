import { useEffect, useMemo, useState } from 'react';
import { useCodex } from '../data';
import { ask, wikiAskText } from '../data/ask';
import { olderClaims, pageClaims, pageStats, proposals, sourcesOf, type Fact, type Source } from '../data/wiki';
import { Confirm, type ConfirmRequest } from '../../ui/Confirm';
import { Icon } from '../../ui/Icon';
import { ShowMore, capGroups, useWindow } from '../../ui/useWindow';
import { setView, useEscapeBack, useView } from '../view';
import { AskBar } from './AskBar';
import { Claim } from './Claim';
import { PageTile } from './PageTile';
import { useReview } from './Review';
import { MEMORY, SOURCE_ICON, memoryPage, shortDate } from './shared';
import { plural } from '../../ui/util';

const SOURCE_NAME: Record<Source['kind'], [string, string]> = { meeting: ['meeting', 'meetings'], slack: ['Slack thread', 'Slack threads'], linear: ['Linear issue', 'Linear issues'], pr: ['pull request', 'pull requests'], doc: ['doc', 'docs'] };
const NO_OLD: Fact[] = [];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function WikiPage({ id }: { id: string }) {
  const { pages, facts } = useCodex();
  const { anchor } = useView();
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  // A cited claim may sit past the window, so a page opened at an anchor shows every claim.
  const [allFor, setAllFor] = useState<string | null>(null);
  const pid = id === MEMORY ? null : id;
  const page = id === MEMORY ? memoryPage(facts) : pages.find((p) => p.id === id && !p.deleted && p.state !== 'rejected');
  const review = useReview();
  const groups = useMemo(() => pageClaims(facts, pid), [facts, pid]);
  const older = useMemo(() => olderClaims(facts, pid), [facts, pid]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.claims.length, 0), [groups]);
  const [shown, more] = useWindow(String(pid));
  const visible = useMemo(() => capGroups(groups, anchor || allFor === id ? Infinity : shown, 'claims'), [groups, shown, anchor, allFor, id]);
  const [showOlder, setShowOlder] = useState(false);
  useEffect(() => setShowOlder(false), [id]);
  // An anchor that arrives before the claims waits for them.
  const loaded = facts.length > 0;
  useEffect(() => {
    if (!anchor || !loaded) return;
    setAllFor(id);
    if (older.some((f) => f.id === anchor)) setShowOlder(true);
    setFlash(anchor);
    setView({ anchor: null });
  }, [anchor, id, loaded, older]);
  // Runs again once Older opens, so a claim in it exists before the scroll.
  useEffect(() => {
    if (!flash) return;
    document.getElementById(`claim-${flash}`)?.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash, showOlder]);
  const pending = useMemo(() => proposals(facts).filter((f) => (f.page_id ?? null) === pid), [facts, pid]);
  const st = useMemo(() => pageStats(facts, pid), [facts, pid]);
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
              {pid && <PageTile page={page} />}
              <h1 className="wk-title">{page.title}</h1>
              {page.summary && <p className="wk-lede">{page.summary}</p>}
              <div className="wk-meta wk-page-meta">
                <span className="wk-kind">Wiki</span>
                <span>{plural(st.claims + pending.length, 'claim')}</span>
                <span>Updated {shortDate(Math.max(page.updated_at, st.updated))}</span>
                {st.contested > 0 && <span className="wk-warn">{st.contested} contested</span>}
              </div>
              {pending.length > 0 && (
                <div className="wk-pending">
                  <span>{page.state === 'proposed' ? 'New page with ' : ''}{pending.length} proposed {pending.length === 1 ? 'claim' : 'claims'}</span>
                  <span className="spacer" />
                  <button className="btn" onClick={() => setConfirm({ title: `Reject ${plural(pending.length, 'claim')}?`, detail: page.title ?? '', action: 'Reject all', run: async () => review.reject(pending) })}>Reject all</button>
                  <button className="btn primary" onClick={() => review.approve(pending)}><Icon name="check" small /> Approve all</button>
                </div>
              )}
              {visible.map((g) => (
                <section key={g.heading} id={`h-${slug(g.heading)}`} className="wk-group">
                  <h2>{g.heading}</h2>
                  <ul className="wk-claims">
                    {g.claims.map(({ fact, old }) => <Claim key={fact.profile + fact.id} fact={fact} old={old} page={page.title ?? ''} flash={flash === fact.id} />)}
                  </ul>
                </section>
              ))}
              <ShowMore shown={shown} total={total} onMore={more} />
              {older.length > 0 && (
                <section className="wk-group wk-older">
                  <button className="wk-older-head" onClick={() => setShowOlder((v) => !v)} aria-expanded={showOlder}>
                    <Icon name={showOlder ? 'chevron-down' : 'chevron-right'} small /> Older · {older.length}
                    <span>Retired or over 90 days old. Claude does not use these.</span>
                  </button>
                  {showOlder && <ul className="wk-claims">{older.map((f) => <Claim key={f.profile + f.id} fact={f} old={NO_OLD} page={page.title ?? ''} flash={flash === f.id} />)}</ul>}
                </section>
              )}
              {!groups.length && !older.length && <div className="wk-none">No claims yet. They appear here as meetings, Slack threads and issues mention {page.title}.</div>}
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
      {confirm && <Confirm {...confirm} onClose={() => setConfirm(null)} />}
      {page && pid && <AskBar placeholder={`Ask about ${page.title}`} onAsk={(q) => ask(wikiAskText(q, pages, facts, id))} />}
    </div>
  );
}
