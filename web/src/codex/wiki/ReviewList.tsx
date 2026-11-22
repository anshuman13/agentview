import { useMemo, useRef, useState } from 'react';
import { useCodex } from '../data';
import { rowKey } from '../data/sync';
import { chatOf, proposals, REJECT_REASONS, replacedClaim, reviewList, similarLive, type Fact } from '../data/wiki/wiki';
import { proposalSource } from '../../../../shared/proposalSource';
import { Icon } from '../../ui/Icon';
import { Button, Chip, IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { EmptyState } from '../../ui/Panel';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
import { setView, useEscapeBack } from '../view';
import { Swipe } from '../gestures/Swipe';
import { ClaimTextForm } from './Claim';
import { Replaces, useReview } from './Review';
import { useClaimEdits } from './useClaimEdits';
import { MEMORY } from './shared';

function ReviewRow({ fact, old, similar, picked, toggle }: { fact: Fact; old?: Fact; similar?: Fact; picked: boolean; toggle: () => void }) {
  const review = useReview();
  const edits = useClaimEdits(fact, '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const chat = chatOf(fact);
  const meta = [proposalSource(fact)?.label, fact.why].filter(Boolean).join(' · ');
  return (
    <li className="wk-item">
      <Swipe onRight={() => review.approve([fact])} onLeft={() => review.reject([fact])} rightLabel="Approve" leftLabel="Reject" leftIcon="close">
        <Row plain lines={2} className={picked ? 'selected' : undefined} role="button" tabIndex={0} aria-pressed={picked} onClick={editing ? undefined : toggle}
          onKeyDown={(e) => { if (!editing && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } }}
          leading={<span className={`as-check${picked ? ' picked' : ''}`}><Icon name={picked ? 'pass-filled' : 'circle-large-outline'} /></span>}
          title={editing ? <ClaimTextForm draft={draft} setDraft={setDraft} onSave={() => { edits.save(draft); setEditing(false); }} onCancel={() => setEditing(false)} rows={2} /> : fact.text}
          meta={editing ? undefined : meta}
          action={<Button variant="primary" size="sm" onClick={() => review.approve([fact])}>Approve</Button>}
          menu={(
            <>
              <MenuItem icon="edit" onClick={() => { setDraft(fact.text ?? ''); setEditing(true); }}>Edit</MenuItem>
              <MenuItem icon="book" onClick={() => setView({ open: fact.page_id ?? MEMORY, anchor: fact.id })}>Open page</MenuItem>
              {chat && <MenuItem icon="sparkle" href={`/?session=${encodeURIComponent(chat)}`}>Open chat</MenuItem>}
              {similar && <MenuItem icon="arrow-swap" onClick={() => review.replace(fact, similar)}>Replace it</MenuItem>}
              <MenuItem icon="close" danger onClick={() => review.reject([fact])}>Reject</MenuItem>
            </>
          )}
        />
      </Swipe>
      {old && <Replaces old={old} />}
      {similar && <Replaces old={similar} similar />}
    </li>
  );
}

// Every proposed claim of the profile filter, by page, with source chips and a selection to decide many at once.
export function ReviewList() {
  const { pages, facts } = useCodex();
  const review = useReview();
  const [filter, setFilter] = useState('all');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [reasons, setReasons] = useState(false);
  const rejectBtn = useRef<HTMLButtonElement>(null);
  const view = useMemo(() => reviewList(pages, facts, filter), [pages, facts, filter]);
  const open = useMemo(() => proposals(facts), [facts]);
  const similar = useMemo(() => similarLive(open, facts), [open, facts]);
  const chosen = open.filter((f) => picked.has(rowKey(f)));
  const back = () => setView({ open: null, anchor: null });
  useEscapeBack(back);
  const pick = (list: Fact[]) => setPicked(new Set([...picked, ...list.map(rowKey)]));
  const toggle = (f: Fact) => {
    const next = new Set(picked);
    if (!next.delete(rowKey(f))) next.add(rowKey(f));
    setPicked(next);
  };
  const decide = (fn: (list: Fact[]) => void) => {
    fn(chosen);
    setPicked(new Set());
    setReasons(false);
  };
  return (
    <div className="wk">
      <header className="wk-head">
        <IconButton icon="arrow-left" label="Back" title="Back to the wiki" onClick={back} />
        <h1>Review claims</h1>
        <span className="spacer" />
        {open.length > 0 && <span className="wk-review-n" aria-live="polite">{open.length}</span>}
      </header>
      <div className="wk-scroll">
        {!open.length ? (
          <EmptyState size="md" icon="check" title="Nothing waits for review" action={<Button size="sm" onClick={back}>Back</Button>} />
        ) : (
          <div className="wk-index">
            <div className="wk-main">
              <div className="wk-review-chips" role="group" aria-label="Filter claims">
                {view.filters.map((c) => <Chip key={c.key} on={view.filter === c.key} onClick={() => setFilter(c.key)}>{c.label} {c.count}</Chip>)}
              </div>
              {view.sections.map((s) => (
                <section key={s.key}>
                  <Section label={s.title} count={sectionCount(s.claims.length)} action={<Button size="sm" variant="plain" onClick={() => pick(s.claims)}>Select</Button>} />
                  <ul className="ui-group wk-list">
                    {s.claims.map((f) => (
                      <ReviewRow key={rowKey(f)} fact={f} old={f.replaces ? replacedClaim(f, facts) ?? facts.find((o) => o.id === f.replaces && o.profile === f.profile) : undefined} similar={similar.get(rowKey(f))} picked={picked.has(rowKey(f))} toggle={() => toggle(f)} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>
      {chosen.length > 0 && (
        <div className="as-bulk" role="toolbar" aria-label="Selected claims">
          <span className="as-bulk-n">{chosen.length} selected</span>
          <Button variant="gray" size="sm" onClick={() => pick(view.sections.flatMap((s) => s.claims))}>Select all</Button>
          <Button variant="filled" size="sm" onClick={() => decide(review.approve)}>Approve</Button>
          <Button ref={rejectBtn} variant="danger" size="sm" aria-haspopup="menu" aria-expanded={reasons} onClick={() => setReasons(!reasons)}>Reject</Button>
          {reasons && (
            <Menu trigger={rejectBtn} onClose={() => setReasons(false)}>
              <MenuItem onClick={() => decide((list) => review.reject(list))}>Reject</MenuItem>
              {REJECT_REASONS.map((r) => <MenuItem key={r} onClick={() => decide((list) => review.reject(list, r))}>{r}</MenuItem>)}
            </Menu>
          )}
          <IconButton icon="close" size="sm" label="Clear selection" onClick={() => setPicked(new Set())} />
        </div>
      )}
    </div>
  );
}
