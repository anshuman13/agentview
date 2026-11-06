import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantTable, useCodex } from '../data';
import { ask, wikiAskText } from '../data/ask';
import { olderClaims, pageClaims, staleClaims, pageStats, newFact, proposals, sourcesOf, type Fact, type Source } from '../data/wiki';
import { mentionsOf, type Mentions } from '../data/mentions';
import { hasLiveClaims, wikiMarkdown } from '../data/wikiMarkdown';
import { Confirm, type ConfirmRequest } from '../../ui/Confirm';
import { Icon } from '../../ui/Icon';
import { Button, Chip, IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { Section } from '../../ui/Section';
import { EmptyState } from '../../ui/Panel';
import { ShowMore, capGroups, useWindow } from '../../ui/useWindow';
import { copyText, setView, showSnack, useEscapeBack, useView } from '../view';
import { AskBar } from './AskBar';
import { Claim } from './Claim';
import { PageTile } from './PageTile';
import { useReview } from './Review';
import { MEMORY, REVIEW, SOURCE_ICON, memoryPage, shortDate } from './shared';
import { plural } from '../../ui/util';

const SOURCE_NAME: Record<Source['kind'], [string, string]> = { meeting: ['meeting', 'meetings'], slack: ['Slack thread', 'Slack threads'], linear: ['Linear issue', 'Linear issues'], pr: ['pull request', 'pull requests'], doc: ['doc', 'docs'] };
const NO_OLD: Fact[] = [];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function WikiPage({ id }: { id: string }) {
  const { pages, facts, meetings } = useCodex();
  const items = useAssistantTable('items');
  const store = useAssistantStore();
  const { anchor, filter } = useView();
  const [menu, setMenu] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  const [proposing, setProposing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  // A cited claim may sit past the window, so a page opened at an anchor shows every claim.
  const [allFor, setAllFor] = useState<string | null>(null);
  const pid = id === MEMORY ? null : id;
  const page = id === MEMORY ? memoryPage(facts) : pages.find((p) => p.id === id && !p.deleted && p.state !== 'rejected');
  const review = useReview();
  const groups = useMemo(() => pageClaims(facts, pid), [facts, pid]);
  const older = useMemo(() => olderClaims(facts, pid), [facts, pid]);
  const stale = useMemo(() => new Set(staleClaims(facts, pid).map((f) => f.id)), [facts, pid]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.claims.length, 0), [groups]);
  const [shown, more] = useWindow(String(pid));
  const visible = useMemo(() => capGroups(groups, anchor || allFor === id ? Infinity : shown, 'claims'), [groups, shown, anchor, allFor, id]);
  const mentions = useMemo(() => {
    const out = new Map<string, Mentions>();
    if (pid && page?.title) for (const g of visible) for (const { fact } of g.claims) if (fact.state !== 'proposed') out.set(fact.profile + fact.id, mentionsOf({ items, meetings }, fact, page.title));
    return out;
  }, [visible, items, meetings, pid, page?.title]);
  const [showOlder, setShowOlder] = useState(false);
  // After Approve all or Reject all the banner stays as a note, so the claims below do not jump up under the finger.
  const [decided, setDecided] = useState<string | null>(null);
  useEffect(() => { setShowOlder(false); setDecided(null); setMenu(false); setProposing(null); setRenaming(null); }, [id]);
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
  const section = page?.section === 'overview' || !pid ? null : page?.section;
  const propose = () => {
    const text = proposing?.trim();
    setProposing(null);
    if (!text || !page) return;
    const fact = newFact(text, pid, pid ? page.profile : filter === 'personal' ? 'personal' : 'work');
    void store.editRow('facts', fact, {});
    showSnack('Claim proposed', () => void store.editRow('facts', fact, { deleted: 1 }));
  };
  const rename = () => {
    const title = renaming?.trim();
    setRenaming(null);
    if (cancelled.current) return;
    cancelled.current = true;
    if (!title || !page || title === page.title) return;
    const prev = page.title;
    void store.editRow('pages', page, { title });
    showSnack('Renamed', () => void store.editRow('pages', page, { title: prev }));
  };
  const archive = () => {
    if (!page) return;
    void store.editRow('pages', page, { state: 'retired' });
    showSnack(`Archived ${page.title}`, () => void store.editRow('pages', page, { state: null }));
    back();
  };
  const pick = (run: () => void) => () => { setMenu(false); run(); };
  return (
    <div className="wk">
      <header className="wk-head">
        <button className="icon-btn" title="Back to the wiki" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        {page && (
          <Section
            label={renaming === null ? page.title : <input autoFocus className="wk-rename" aria-label="Page title" value={renaming} onChange={(e) => setRenaming(e.target.value)} onFocus={(e) => e.target.select()} onBlur={rename}
              onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') { e.stopPropagation(); cancelled.current = true; setRenaming(null); } }} />}
            action={
              <span className="as-tt-actions">
                <Button size="sm" variant="filled" icon="add" onClick={() => setProposing((v) => v ?? '')}>Propose claim</Button>
                <span className="wk-stale-more">
                  <IconButton ref={moreBtn} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
                  {menu && (
                    <Menu trigger={moreBtn} onClose={() => setMenu(false)}>
                      {pid && <MenuItem icon="edit" onClick={pick(() => { cancelled.current = false; setRenaming(page.title ?? ''); })}>Rename</MenuItem>}
                      {pending.length > 0 && <MenuItem icon="checklist" onClick={pick(() => setView({ open: REVIEW, anchor: null }))}>Review</MenuItem>}
                      {hasLiveClaims(groups) && <MenuItem icon="copy" onClick={pick(() => copyText(wikiMarkdown(page.title, groups)))}>Copy as Markdown</MenuItem>}
                      {pid && <MenuSeparator />}
                      {pid && <MenuItem icon="archive" danger onClick={pick(archive)}>Archive</MenuItem>}
                    </Menu>
                  )}
                </span>
              </span>
            }
          />
        )}
      </header>
      <div className="wk-scroll">
        {!page ? (
          <EmptyState size="sm" icon="book" title="This page is gone." action={<Button size="sm" onClick={back}>Back to the wiki</Button>} />
        ) : (
          <div className="wk-doc">
            <article className="wk-article">
              <div className="wk-chips">
                {section && <Chip quiet tabIndex={-1}>{section}</Chip>}
                <Chip quiet tabIndex={-1}>{plural(st.claims, 'claim')}</Chip>
                {st.updated > 0 && <Chip quiet tabIndex={-1}>Updated {shortDate(Math.max(page.updated_at, st.updated))}</Chip>}
                {st.contested > 0 && <Chip quiet late tabIndex={-1}>{st.contested} contested</Chip>}
              </div>
              {proposing !== null && (
                <div className="wk-contest-form">
                  <textarea autoFocus rows={2} value={proposing} aria-label="Claim" onChange={(e) => setProposing(e.target.value)}
                    onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Escape') { e.stopPropagation(); setProposing(null); } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) propose(); }} />
                  <div className="wk-contest-btns">
                    <button className="btn" onClick={() => setProposing(null)}>Cancel</button>
                    <button className="btn primary" onClick={propose}>Save</button>
                  </div>
                </div>
              )}
              {pid && <PageTile page={page} />}
              {page.summary && <p className="wk-lede">{page.summary}</p>}
              {pending.length > 0 ? (
                <div className="wk-pending">
                  <span>{page.state === 'proposed' ? 'New page with ' : ''}{pending.length} proposed {pending.length === 1 ? 'claim' : 'claims'}</span>
                  <span className="spacer" />
                  <button className="btn" onClick={() => setConfirm({ title: `Reject ${plural(pending.length, 'claim')}?`, detail: page.title ?? '', action: 'Reject all', run: async () => { review.reject(pending); setDecided(`Rejected ${plural(pending.length, 'claim')}`); } })}>Reject all</button>
                  <button className="btn primary" onClick={() => { review.approve(pending); setDecided(`Approved ${plural(pending.length, 'claim')}`); }}><Icon name="check" small /> Approve all</button>
                </div>
              ) : decided && <div className="wk-pending wk-decided"><Icon name="check" small /> {decided}</div>}
              {visible.map((g) => {
                const open = g.claims.filter((c) => c.fact.state === 'proposed').map((c) => c.fact);
                return (
                <section key={g.heading} id={`h-${slug(g.heading)}`} className="wk-group">
                  <h2>{g.heading}{open.length > 1 && <button className="wk-act wk-head-act" onClick={() => review.approve(open)}><Icon name="check" small /> Approve {open.length}</button>}</h2>
                  <ul className="wk-claims">
                    {g.claims.map(({ fact, old }) => <Claim key={fact.profile + fact.id} fact={fact} old={old} page={page.title ?? ''} flash={flash === fact.id} mentions={mentions.get(fact.profile + fact.id)} />)}
                  </ul>
                </section>
                );
              })}
              <ShowMore shown={shown} total={total} onMore={more} />
              {older.length > 0 && (
                <section className="wk-group wk-older">
                  <button className="wk-older-head" onClick={() => setShowOlder((v) => !v)} aria-expanded={showOlder}>
                    <Icon name={showOlder ? 'chevron-down' : 'chevron-right'} small /> Older · {older.length}
                    {stale.size > 0 && <span className="badge quiet">{stale.size} to confirm</span>}
                    <span>Retired or over 90 days old. Claude does not use these.</span>
                  </button>
                  {showOlder && <ul className="wk-claims">{older.map((f) => <Claim key={f.profile + f.id} fact={f} old={NO_OLD} page={page.title ?? ''} flash={flash === f.id} stale={stale.has(f.id)} />)}</ul>}
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
      {page && pid && <AskBar placeholder={`Ask about ${page.title}`} onAsk={(q) => ask(wikiAskText(q, pages, facts, id), page.profile)} />}
    </div>
  );
}
