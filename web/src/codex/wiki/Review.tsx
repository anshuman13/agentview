import { useMemo, useState, type ReactNode } from 'react';
import { useAssistantStore, useCodex } from '../data';
import { approveAllChanges, approveChanges, proposals, rejectChanges, staleFacts, driftFacts, type Fact } from '../data/wiki/wiki';
import { Button, ShowAll } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { MenuItem } from '../../ui/Menu';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
import { plural } from '../../ui/util';
import { Fold } from '../Fold';
import { setView, showSnack } from '../view';
import { useClaimEdits } from './useClaimEdits';
import { REVIEW, shortDate } from './shared';

// On phones the replaced claim is clamped to two lines; a tap shows all of it.
export function Replaces({ old, similar }: { old: Fact; similar?: boolean }) {
  const [open, setOpen] = useState(false);
  return <div className={`wk-old wk-replaces${similar ? ' wk-similar' : ''}${open ? ' open' : ''}`} onClick={() => setOpen(!open)}><s>{old.text}</s><span>{similar ? 'Similar to' : 'Replaces'}</span></div>;
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
    approve: (list: Fact[]) => run(approveAllChanges(list, store.snapshot().pages, store.snapshot().facts), `Approved ${plural(list.length, 'claim')}`, list.length),
    replace: (fact: Fact, old: Fact) => {
      const [first, ...rest] = approveChanges({ ...fact, replaces: old.id }, store.snapshot().pages, store.snapshot().facts);
      run([{ ...first, patch: { ...first.patch, replaces: old.id }, undo: { ...first.undo, replaces: null } }, ...rest], 'Approved 1 claim, replacing the old one', 1);
    },
    reject: (list: Fact[], reason: string | null = null) => run(rejectChanges(list, store.snapshot().pages, store.snapshot().facts, reason), `Rejected ${plural(list.length, 'claim')}`, list.length),
  };
}

export function ToReview({ facts }: { facts: Fact[] }) {
  const n = proposals(facts).length;
  if (!n) return null;
  return (
    <div className="ui-group">
      <Row title={`${plural(n, 'claim')} to review`} trailing={<Icon name="chevron-right" small />} onClick={() => setView({ open: REVIEW, anchor: null })} />
    </div>
  );
}

const LOOK_CAP = 3;

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
