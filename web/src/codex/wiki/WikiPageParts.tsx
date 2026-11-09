import { type Dispatch, type SetStateAction } from 'react';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/Button';
import { Section, sectionCount } from '../../ui/Section';
import type { ConfirmRequest } from '../../ui/Confirm';
import { plural } from '../../ui/util';
import type { Fact, Page, pageClaims } from '../data/wiki/wiki';
import type { Mentions } from '../data/meetings/mentions';
import { Claim } from './Claim';
import type { useReview } from './Review';

const NO_OLD: Fact[] = [];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

type Review = ReturnType<typeof useReview>;

export function ProposeForm({ value, setValue, save }: { value: string; setValue: (v: string | null) => void; save: () => void }) {
  return (
    <div className="wk-contest-form">
      <textarea autoFocus rows={2} value={value} aria-label="Claim" onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Escape') { e.stopPropagation(); setValue(null); } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
      <div className="wk-contest-btns">
        <button className="btn" onClick={() => setValue(null)}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}

type BannerProps = { pending: Fact[]; page: Page; decided: string | null; setDecided: (s: string) => void; review: Review; setConfirm: Dispatch<SetStateAction<ConfirmRequest | null>> };

export function PendingBanner({ pending, page, decided, setDecided, review, setConfirm }: BannerProps) {
  if (pending.length === 0) return decided ? <div className="wk-pending wk-decided"><Icon name="check" small /> {decided}</div> : null;
  return (
    <div className="wk-pending">
      <span>{page.state === 'proposed' ? 'New page with ' : ''}{pending.length} proposed {pending.length === 1 ? 'claim' : 'claims'}</span>
      <span className="spacer" />
      <button className="btn" onClick={() => setConfirm({ title: `Reject ${plural(pending.length, 'claim')}?`, detail: page.title ?? '', action: 'Reject all', run: async () => { review.reject(pending); setDecided(`Rejected ${plural(pending.length, 'claim')}`); } })}>Reject all</button>
      <button className="btn primary" onClick={() => { review.approve(pending); setDecided(`Approved ${plural(pending.length, 'claim')}`); }}><Icon name="check" small /> Approve all</button>
    </div>
  );
}

type GroupsProps = { groups: ReturnType<typeof pageClaims>; page: string; flash: string | null; mentions: Map<string, Mentions>; review: Review };

export function ClaimGroups({ groups, page, flash, mentions, review }: GroupsProps) {
  return (
    <>
      {groups.map((g) => {
        const open = g.claims.filter((c) => c.fact.state === 'proposed').map((c) => c.fact);
        return (
          <section key={g.heading} id={`h-${slug(g.heading)}`} className="wk-group">
            <Section label={g.heading} count={sectionCount(g.claims.length)} action={open.length > 1 && <Button size="sm" variant="plain" onClick={() => review.approve(open)}>Approve {open.length}</Button>} />
            <ul className="ui-group wk-list">
              {g.claims.map(({ fact, old }) => <Claim key={fact.profile + fact.id} fact={fact} old={old} page={page} flash={flash === fact.id} mentions={mentions.get(fact.profile + fact.id)} />)}
            </ul>
          </section>
        );
      })}
    </>
  );
}

type OlderProps = { older: Fact[]; stale: Set<string>; open: boolean; toggle: () => void; page: string; flash: string | null };

export function OlderClaims({ older, stale, open, toggle, page, flash }: OlderProps) {
  if (older.length === 0) return null;
  return (
    <section className="wk-older">
      <Section label={<>Older{stale.size > 0 && <span className="muted">{stale.size} to confirm</span>}</>} count={older.length} open={open} onToggle={toggle} />
      {open && <div className="wk-older-hint">Retired or over 90 days old. The agent does not use these.</div>}
      {open && <ul className="ui-group wk-list">{older.map((f) => <Claim key={f.profile + f.id} fact={f} old={NO_OLD} page={page} flash={flash === f.id} stale={stale.has(f.id)} />)}</ul>}
    </section>
  );
}
