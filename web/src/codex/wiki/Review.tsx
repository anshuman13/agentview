import { useMemo, useState, type ReactNode } from 'react';
import { useAssistantStore, useCodex } from '../data';
import { approveAllChanges, approveChanges, chatOf, factTime, meetingOf, proposals, reviewCount, reviewGroups, sourcesOf, staleFacts, driftFacts, type Fact, type Page } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { Fold } from '../Fold';
import { setView, showSnack } from '../view';
import { ClaudeChip, SourceChip } from './Chips';
import { PageTile } from './PageTile';
import { shortDate } from './shared';

function ReviewCard({ fact }: { fact: Fact }) {
  const { store, pages, facts, meetings } = useCodex();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.text ?? '');
  const page = fact.page_id ? pages.find((p) => p.id === fact.page_id && p.profile === fact.profile) : undefined;
  const old = fact.replaces ? facts.find((f) => f.id === fact.replaces && f.profile === fact.profile) : undefined;
  const chat = chatOf(fact);
  const from = meetingOf(fact);
  const meeting = from ? meetings.find((m) => m.id === from && m.profile === fact.profile) : undefined;
  const label = from
    ? meeting?.title ?? sourcesOf(fact).find((s) => s.kind === 'meeting')?.label ?? 'a meeting'
    : fact.added_by?.startsWith('slack:') ? sourcesOf(fact).find((s) => s.kind === 'slack')?.label ?? 'Slack' : null;
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
      {label && <div className="wk-meta"><span>From {label}</span></div>}
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

// Reads pages and facts when a button is pressed, so a claim row does not re-render for every store change.
export function useReview() {
  const store = useAssistantStore();
  const run = (changes: { table: 'facts' | 'pages'; row: unknown; patch: unknown; undo: unknown }[], text: string) => {
    changes.forEach((c) => void store.editRow(c.table, c.row as never, c.patch as never));
    showSnack(text, () => changes.forEach((c) => void store.editRow(c.table, c.row as never, c.undo as never)));
  };
  return {
    approve: (list: Fact[]) => run(approveAllChanges(list, store.snapshot().pages, store.snapshot().facts), `Approved ${list.length} ${list.length === 1 ? 'claim' : 'claims'}`),
    reject: (list: Fact[]) => {
      const { pages, facts } = store.snapshot();
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
  return (
    <div className="mt-action proposed wk-review">
      <div className="mt-action-kind"><Icon name="book" small />{page.state === 'proposed' ? `New page in ${page.section}` : 'Additions'}{page.profile === 'personal' && <span className="wk-src">Personal</span>}</div>
      <PageTile page={page} />
      <div className="mt-action-title"><button className="wk-review-open" onClick={() => setView({ open: page.id, anchor: null })}>{page.title} <Icon name="chevron-right" small /></button></div>
      {page.summary && <div className="mt-action-body">{page.summary}</div>}
      <div className="wk-meta">
        <span>{list.length} {list.length === 1 ? 'claim' : 'claims'}</span>
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

const REVIEW_CAP = 3;
const LOOK_CAP = 3;

export function ToReview({ facts }: { facts: Fact[] }) {
  const { pages } = useCodex();
  const { byPage, loose } = useMemo(() => reviewGroups(pages, facts), [pages, facts]);
  const [all, setAll] = useState(false);
  if (!byPage.length && !loose.length) return null;
  const cards = [
    ...byPage.map(({ page, list }) => <PageReview key={page.profile + page.id} page={page} list={list} />),
    ...loose.map((f) => <ReviewCard key={f.profile + f.id} fact={f} />),
  ];
  return (
    <section>
      <div className="wk-label">To review · {reviewCount(pages, facts)}</div>
      <div className="wk-reviews">
        {all ? cards : cards.slice(0, REVIEW_CAP)}
        {!all && cards.length > REVIEW_CAP && <button className="wk-more" onClick={() => setAll(true)}>Show {cards.length - REVIEW_CAP} more</button>}
      </div>
    </section>
  );
}

function Rows<T>({ label, list, row }: { label: string; list: T[]; row: (t: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  if (!list.length) return null;
  return (
    <div>
      <div className="wk-label">{label} · {list.length}</div>
      <ol className="wk-feed-list">{(all ? list : list.slice(0, LOOK_CAP)).map(row)}</ol>
      {!all && list.length > LOOK_CAP && <button className="wk-more" onClick={() => setAll(true)}>+{list.length - LOOK_CAP} more</button>}
    </div>
  );
}

function useLook() {
  const { pages, facts, meetings } = useCodex();
  const stale = useMemo(() => staleFacts(facts, pages, meetings), [pages, facts, meetings]);
  const drift = useMemo(() => driftFacts(facts, pages, meetings), [pages, facts, meetings]);
  const title = useMemo(() => new Map(pages.map((p) => [`${p.profile}:${p.id}`, p.title])), [pages]);
  return { stale, drift, title };
}

function staleRow(title: Map<string, string | null>) {
  return (f: Fact) => {
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
  };
}

// Claims a later meeting decision may have changed; opening one goes to the claim to edit or replace it.
function driftRow(title: Map<string, string | null>) {
  return ({ fact: f, decision: d }: ReturnType<typeof driftFacts>[number]) => (
    <li key={f.profile + f.id}>
      <button onClick={() => setView({ list: 'wiki', open: f.page_id, anchor: f.id })}>
        <span className="wk-feed-top"><span className="wk-feed-page">{title.get(`${f.profile}:${f.page_id}`)}</span></span>
        <span className="wk-feed-text">{f.text}</span>
        <span className="wk-meta"><span>{d.meeting.title ?? 'Meeting'}, {shortDate(d.at)}: {d.text}</span></span>
      </button>
    </li>
  );
}

export function NeedsLook() {
  const { stale, drift, title } = useLook();
  return (
    <Fold id="wiki-look" title="Needs a look" count={stale.length + drift.length}>
      <Rows label="Stale" list={stale} row={staleRow(title)} />
      <Rows label="Maybe changed" list={drift} row={driftRow(title)} />
    </Fold>
  );
}

export function Stale() {
  const { stale, title } = useLook();
  return <Rows label="Stale" list={stale} row={staleRow(title)} />;
}

export function Drift() {
  const { drift, title } = useLook();
  return <Rows label="Maybe changed" list={drift} row={driftRow(title)} />;
}
