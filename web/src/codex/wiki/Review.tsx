import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useAssistantStore, useCodex } from '../data';
import { rowKey } from '../data/sync';
import { approveAllChanges, approveChanges, chatOf, meetingOf, proposals, replacedClaim, reviewCount, reviewGroups, similarLive, sourcesOf, staleFacts, driftFacts, type Fact, type Page } from '../data/wiki/wiki';
import { Button, IconButton, ShowAll } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { MenuItem } from '../../ui/Menu';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
import { Fold } from '../Fold';
import { setView, showSnack } from '../view';
import { ClaudeChip, SourceChip } from './Chips';
import { PageTile } from './PageTile';
import { useClaimEdits } from './useClaimEdits';
import { REVIEW, shortDate } from './shared';
import { UNTITLED } from '../../../../shared/util';
import { repeatedInFolder } from '../../../../shared/claimMatch';
import { useStore } from '../../app/store';
import { addRepoRule } from '../../chat/cards/Memory';

// On phones the replaced claim is clamped to two lines; a tap shows all of it.
export function Replaces({ old, similar }: { old: Fact; similar?: boolean }) {
  const [open, setOpen] = useState(false);
  return <div className={`wk-old wk-replaces${similar ? ' wk-similar' : ''}${open ? ' open' : ''}`} onClick={() => setOpen(!open)}><s>{old.text}</s><span>{similar ? 'Similar to' : 'Replaces'}</span></div>;
}

function ReviewCard({ fact, repeated, similar }: { fact: Fact; repeated: boolean; similar?: Fact }) {
  const { pages, facts, meetings } = useCodex();
  const edits = useClaimEdits(fact, '');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.text ?? '');
  const page = fact.page_id ? pages.find((p) => p.id === fact.page_id && p.profile === fact.profile) : undefined;
  const old = fact.replaces ? replacedClaim(fact, facts) ?? facts.find((f) => f.id === fact.replaces && f.profile === fact.profile) : undefined;
  const chat = chatOf(fact);
  const from = meetingOf(fact);
  const meeting = from ? meetings.find((m) => m.id === from && m.profile === fact.profile) : undefined;
  const fromChat = sourcesOf(fact).find((s) => s.kind === 'chat');
  const label = from
    ? meeting?.title ?? sourcesOf(fact).find((s) => s.kind === 'meeting')?.label ?? 'a meeting'
    : fact.added_by?.startsWith('slack:') ? sourcesOf(fact).find((s) => s.kind === 'slack')?.label ?? 'Slack'
    : fact.added_by?.startsWith('pr:') ? sourcesOf(fact).find((s) => s.kind === 'pr')?.label ?? 'a pull request' : fromChat ? `chat ${fromChat.label || UNTITLED}` : null;
  const folder = fromChat?.folder;
  const repoChat = useStore((s) => s.live.find((c) => c.cwd === folder)?.id);
  const [added, setAdded] = useState(false);
  const review = useReview();
  const approve = () => review.approve([fact]);
  const reject = () => review.reject([fact]);
  const addRule = async () => {
    try {
      const undo = await addRepoRule('CLAUDE.md', fact.text ?? '', repoChat);
      setAdded(true);
      showSnack('Added to CLAUDE.md', () => { setAdded(false); void undo(); });
    } catch {
      showSnack('Could not add to CLAUDE.md');
    }
  };
  const save = () => {
    edits.save(text);
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
      {old && <Replaces old={old} />}
      {similar && <Replaces old={similar} similar />}
      <div className="wk-claim-foot">
        {sourcesOf(fact).filter((s) => s.kind !== 'chat').map((s, i) => <SourceChip key={i} s={s} />)}
        {chat && <ClaudeChip chat={chat} />}
        {fact.at != null && <span className="wk-claim-date">{shortDate(fact.at)}</span>}
      </div>
      <div className="mt-action-foot">
        {editing ? (
          <>
            <span className="spacer" />
            <Button onClick={() => { setEditing(false); setText(fact.text ?? ''); }}>Cancel</Button>
            <Button variant="primary" onClick={save}>Save</Button>
          </>
        ) : (
          <>
            <Button variant="plain" size="sm" icon="edit" onClick={() => { setText(fact.text ?? ''); setEditing(true); }}>Edit</Button>
            {similar && <Button variant="plain" size="sm" icon="arrow-swap" onClick={() => review.replace(fact, similar)}>Replace it</Button>}
            {repeated && repoChat && !added && <Button variant="plain" size="sm" icon="add" onClick={() => void addRule()}>Add to CLAUDE.md</Button>}
            <span className="spacer" />
            <IconButton icon="close" label="Reject" className="mt-reject" onClick={reject} />
            <Button variant="primary" icon="check" className="mt-approve" onClick={approve}>Approve</Button>
          </>
        )}
      </div>
    </div>
  );
}

const BATCH = 5;
const BATCH_MS = 10_000;
// Decisions within this gap of each other share one Undo, so a run of swipes can be taken back together.
const RUN_MS = 8_000;
let run_: { undos: (() => void)[]; n: number; at: number } = { undos: [], n: 0, at: 0 };

// Reads pages and facts when a button is pressed, so a claim row does not re-render for every store change.
export function useReview() {
  const store = useAssistantStore();
  const run = (changes: { table: 'facts' | 'pages'; row: unknown; patch: unknown; undo: unknown }[], text: string, n: number) => {
    changes.forEach((c) => void store.editRow(c.table, c.row as never, c.patch as never));
    const now = Date.now();
    if (now - run_.at > RUN_MS) run_ = { undos: [], n: 0, at: now };
    run_.undos.push(() => changes.forEach((c) => void store.editRow(c.table, c.row as never, c.undo as never)));
    run_.n += n;
    run_.at = now;
    const all = run_;
    const label = all.n > n ? `${text}, ${all.n} in a row` : text;
    showSnack(label, () => { all.undos.reverse().forEach((u) => u()); run_ = { undos: [], n: 0, at: 0 }; }, all.n >= BATCH ? BATCH_MS : undefined);
  };
  return {
    approve: (list: Fact[]) => run(approveAllChanges(list, store.snapshot().pages, store.snapshot().facts), `Approved ${list.length} ${list.length === 1 ? 'claim' : 'claims'}`, list.length),
    replace: (fact: Fact, old: Fact) => {
      const [first, ...rest] = approveChanges({ ...fact, replaces: old.id }, store.snapshot().pages, store.snapshot().facts);
      run([{ ...first, patch: { state: 'live', replaces: old.id }, undo: { state: 'proposed', replaces: null } }, ...rest], 'Approved 1 claim, replacing the old one', 1);
    },
    reject: (list: Fact[]) => {
      const { pages, facts } = store.snapshot();
      const page = pages.find((p) => list.length && p.id === list[0].page_id && p.profile === list[0].profile && p.state === 'proposed');
      const rest = page && proposals(facts).every((f) => f.page_id !== page.id || list.includes(f));
      run([
        ...list.map((f) => ({ table: 'facts' as const, row: f, patch: { state: 'rejected' }, undo: { state: 'proposed' } })),
        ...(rest ? [{ table: 'pages' as const, row: page, patch: { state: 'rejected' }, undo: { state: 'proposed' } }] : []),
      ], `Rejected ${list.length} ${list.length === 1 ? 'claim' : 'claims'}`, list.length);
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
      <ul className="wk-review-peek">
        {list.slice(0, PEEK).map((f) => <li key={f.profile + f.id}>{f.text}</li>)}
      </ul>
      <div className="mt-action-foot">
        <Button variant="plain" size="sm" icon="book" onClick={() => setView({ open: page.id, anchor: null })}>{list.length > PEEK ? `Read all ${list.length}` : 'Read and edit'}</Button>
        <span className="spacer" />
        <IconButton icon="close" label="Reject all" className="mt-reject" onClick={() => review.reject(list)} />
        <Button variant="primary" icon="check" className="mt-approve" onClick={() => review.approve(list)}>Approve all</Button>
      </div>
    </div>
  );
}

function ChatReview({ chat, list }: { chat: string; list: Fact[] }) {
  const review = useReview();
  const title = sourcesOf(list[0]).find((s) => s.kind === 'chat')?.label || UNTITLED;
  return (
    <div className="mt-action proposed wk-review">
      <div className="mt-action-kind"><Icon name="lightbulb" small />Memory{list[0].profile === 'personal' && <span className="wk-src">Personal</span>}</div>
      <div className="wk-meta"><span>From chat {title}</span></div>
      <ul className="wk-review-peek">
        {list.map((f) => <li key={f.profile + f.id}>{f.text}</li>)}
      </ul>
      <div className="wk-claim-foot"><ClaudeChip chat={chat} /></div>
      <div className="mt-action-foot">
        <span className="spacer" />
        <IconButton icon="close" label="Reject all" className="mt-reject" onClick={() => review.reject(list)} />
        <Button variant="primary" icon="check" className="mt-approve" onClick={() => review.approve(list)}>Approve all</Button>
      </div>
    </div>
  );
}

const PEEK = 3;
const LOOSE_CAP = 3;
const LOOK_CAP = 3;

// A card that was decided stays in its slot as a stub while the list is open, so the next card's buttons do not move under the finger.
function Decided({ n }: { n: number }) {
  return <div className="mt-action wk-review wk-decided"><Icon name="check" small /> {n} {n === 1 ? 'claim' : 'claims'} decided</div>;
}

export function ToReview({ facts }: { facts: Fact[] }) {
  const { pages, facts: everyFact } = useCodex();
  const { byPage, chats, loose } = useMemo(() => reviewGroups(pages, facts), [pages, facts]);
  const repeated = useMemo(() => repeatedInFolder(everyFact.flatMap((f) => {
    const dir = sourcesOf(f).find((s) => s.kind === 'chat')?.folder;
    return dir && !f.deleted && !f.page_id && (f.state === 'proposed' || (f.state ?? 'live') === 'live') ? [{ id: f.profile + f.id, text: f.text ?? '', folder: dir }] : [];
  })), [everyFact]);
  const similar = useMemo(() => similarLive(loose, everyFact), [loose, everyFact]);
  const [all, setAll] = useState(false);
  const order = useRef<Map<string, { n: number; page: boolean }>>(new Map());
  const live = new Map<string, ReactNode>();
  for (const { page, list } of byPage) {
    const k = page.profile + page.id;
    live.set(k, <PageReview key={k} page={page} list={list} />);
    if (!order.current.has(k)) order.current.set(k, { n: list.length, page: true });
  }
  for (const list of chats) {
    const k = `chat:${list[0].profile}:${chatOf(list[0])}`;
    live.set(k, <ChatReview key={k} chat={chatOf(list[0])!} list={list} />);
    if (!order.current.has(k)) order.current.set(k, { n: list.length, page: false });
  }
  for (const f of loose) {
    const k = f.profile + f.id;
    live.set(k, <ReviewCard key={k} fact={f} repeated={repeated.has(k)} similar={similar.get(rowKey(f))} />);
    if (!order.current.has(k)) order.current.set(k, { n: 1, page: false });
  }
  if (!order.current.size) return null;
  const slots = [...order.current].sort(([, a], [, b]) => Number(b.page) - Number(a.page));
  const cards = slots.map(([k, { n }]) => live.get(k) ?? <Decided key={k} n={n} />);
  const cap = slots.filter(([, s]) => s.page).length + LOOSE_CAP;
  const shown = all ? cards : cards.slice(0, cap);
  return (
    <section>
      <Section label="To review" count={reviewCount(pages, facts)} action={<Button size="sm" variant="quiet" icon="checklist" onClick={() => setView({ open: REVIEW, anchor: null })}>One at a time</Button>} />
      <div className="wk-reviews">
        {shown}
        {!all && cards.length > shown.length && <ShowAll count={cards.length} onClick={() => setAll(true)} />}
      </div>
    </section>
  );
}

function Rows<T>({ label, list, row }: { label: string; list: T[]; row: (t: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  if (!list.length) return null;
  return (
    <div>
      <Section label={label} count={sectionCount(list.length)} />
      <div className="as-group">{(all ? list : list.slice(0, LOOK_CAP)).map(row)}</div>
      {!all && list.length > LOOK_CAP && <ShowAll count={list.length} onClick={() => setAll(true)} />}
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

function StaleRow({ fact: f, title }: { fact: Fact; title: Map<string, string | null> }) {
  const pageTitle = title.get(`${f.profile}:${f.page_id}`);
  const edits = useClaimEdits(f, pageTitle ?? '');
  const months = Math.floor((Date.now() - (f.at ?? 0)) / (30 * 86_400_000));
  return (
    <Row
      lines={2}
      title={f.text}
      meta={`${pageTitle} · ${months} ${months === 1 ? 'month' : 'months'}${f.used_count ? ` · Used on ${f.used_count} ${f.used_count === 1 ? 'day' : 'days'}` : ''}`}
      onClick={() => setView({ list: 'wiki', open: f.page_id, anchor: f.id })}
      action={<Button variant="tinted" size="sm" onClick={edits.confirm}>Confirm</Button>}
      menu={<MenuItem icon="archive" danger onClick={edits.retire}>Retire</MenuItem>}
    />
  );
}

const staleRow = (title: Map<string, string | null>) => (f: Fact) => <StaleRow key={f.profile + f.id} fact={f} title={title} />;

// Claims a later meeting decision may have changed; opening one goes to the claim to edit or replace it.
function driftRow(title: Map<string, string | null>) {
  return ({ fact: f, decision: d }: ReturnType<typeof driftFacts>[number]) => (
    <Row
      key={f.profile + f.id}
      lines={2}
      title={f.text}
      meta={`${title.get(`${f.profile}:${f.page_id}`)} · ${d.meeting.title ?? 'Meeting'}, ${shortDate(d.at)}: ${d.text}`}
      onClick={() => setView({ list: 'wiki', open: f.page_id, anchor: f.id })}
    />
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
