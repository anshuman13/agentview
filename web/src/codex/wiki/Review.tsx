import { useMemo, useState } from 'react';
import { useCodex } from '../data';
import { approveAllChanges, approveChanges, chatOf, factTime, proposals, reviewCount, sourcesOf, staleFacts, type Fact, type Page } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { setView, showSnack } from '../view';
import { ClaudeChip, SourceChip } from './Chips';
import { PageTile } from './PageTile';
import { shortDate } from './shared';

function ReviewCard({ fact }: { fact: Fact }) {
  const { store, pages, facts } = useCodex();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.text ?? '');
  const page = fact.page_id ? pages.find((p) => p.id === fact.page_id && p.profile === fact.profile) : undefined;
  const old = fact.replaces ? facts.find((f) => f.id === fact.replaces && f.profile === fact.profile) : undefined;
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

export function useReview() {
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
      <PageTile page={page} />
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

export function ToReview({ facts }: { facts: Fact[] }) {
  const { pages } = useCodex();
  const { list, byPage, loose, livePages } = useMemo(() => {
    const list = proposals(facts);
    const byPage = new Map<string, Fact[]>();
    for (const f of list) if (f.page_id) { const fs = byPage.get(f.page_id); if (fs) fs.push(f); else byPage.set(f.page_id, [f]); }
    const livePages = new Map(pages.filter((p) => !p.deleted).map((p) => [`${p.profile}:${p.id}`, p]));
    const liveIds = new Set(pages.filter((p) => !p.deleted).map((p) => p.id));
    const loose = list.filter((f) => !f.page_id || !liveIds.has(f.page_id));
    return { list, byPage, loose, livePages };
  }, [pages, facts]);
  if (!list.length) return null;
  return (
    <section>
      <div className="wk-label">To review · {reviewCount(pages, facts)}</div>
      <div className="wk-reviews">
        {[...byPage].map(([id, fs]) => {
          const page = livePages.get(`${fs[0].profile}:${id}`);
          return page && <PageReview key={page.profile + id} page={page} list={fs} />;
        })}
        {loose.map((f) => <ReviewCard key={f.profile + f.id} fact={f} />)}
      </div>
    </section>
  );
}

export function Stale() {
  const { pages, facts, meetings } = useCodex();
  const list = useMemo(() => staleFacts(facts, pages, meetings), [pages, facts, meetings]);
  if (!list.length) return null;
  const title = new Map(pages.map((p) => [`${p.profile}:${p.id}`, p.title]));
  return (
    <section>
      <div className="wk-label">Stale · {list.length}</div>
      <ol className="wk-feed-list">
        {list.slice(0, 10).map((f) => {
          const months = Math.floor((Date.now() - factTime(f)) / (30 * 86_400_000));
          return (
            <li key={f.profile + f.id}>
              <button onClick={() => setView({ list: 'wiki', open: f.page_id, anchor: f.id })}>
                <span className="wk-feed-top"><span className="wk-feed-page">{title.get(`${f.profile}:${f.page_id}`)}</span></span>
                <span className="wk-feed-text">{f.text}</span>
                <span className="wk-meta"><span>{months} {months === 1 ? 'month' : 'months'}</span></span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
