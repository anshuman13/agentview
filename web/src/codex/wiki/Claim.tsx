import { memo, useState, type ReactNode } from 'react';
import { contestOf, sourcesOf, type Fact } from '../data/wiki/wiki';
import type { Mentions } from '../data/meetings/mentions';
import { Button, IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { ago } from '../../ui/util';
import { Swipe } from '../gestures/Swipe';
import { SourceChip } from './Chips';
import { ClaimMenu } from './ClaimMenu';
import { useClaimEdits } from './useClaimEdits';
import { useReview } from './Review';
import { actionsFor, shortDate, type ClaimButton } from './shared';

export const Claim = memo(function Claim({ fact, old, page, flash, mentions, stale }: { fact: Fact; old: Fact[]; page: string; flash: boolean; mentions?: Mentions; stale?: boolean }) {
  const review = useReview();
  const edits = useClaimEdits(fact, page);
  const proposed = fact.state === 'proposed';
  const [contesting, setContesting] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState(false);
  const c = contestOf(fact);
  const sources = sourcesOf(fact);
  const startEdit = () => { setDraft(fact.text ?? ''); setEditing(true); };
  const save = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== fact.text) edits.save(next);
  };
  const contest = () => {
    edits.contest(note);
    setContesting(false);
    setNote('');
  };
  const { buttons, menu: items } = actionsFor(fact, { stale, editing, contesting });
  const actions = { ...edits, edit: startEdit, contest: () => setContesting(true) };
  const button: Record<ClaimButton, ReactNode> = {
    reject: <IconButton key="reject" size="sm" icon="close" label="Reject" onClick={() => review.reject([fact])} />,
    approve: <IconButton key="approve" size="sm" icon="check" label="Approve" onClick={() => review.approve([fact])} />,
    confirm: <Button key="confirm" variant="tinted" size="sm" onClick={edits.confirm}>Confirm</Button>,
    more: <ClaimMenu key="more" fact={fact} items={items} actions={actions} open={menu} setOpen={setMenu} mentions={mentions} stale={stale} />,
  };
  return (
    <li className={`wk-item${flash ? ' flash' : ''}`} id={`claim-${fact.id}`}>
      <Swipe onRight={proposed ? () => review.approve([fact]) : undefined} onLeft={proposed ? () => review.reject([fact]) : undefined} rightLabel="Approve" leftLabel="Reject" leftIcon="close">
        <Row plain lines={2} onLongPress={items.length ? () => setMenu(true) : undefined}
          title={editing ? (
            <span className="wk-contest-form">
              <textarea autoFocus rows={2} value={draft} aria-label="Claim" onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Escape') setEditing(false); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
              <span className="wk-contest-btns">
                <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn primary" onClick={save}>Save</button>
              </span>
            </span>
          ) : fact.text}
          meta={editing ? undefined : (
            <>
              {proposed && <span>Proposed</span>}
              {c && <span>Contested by {c.by} - {ago(c.at, ' ago')}</span>}
              {sources[0] && <SourceChip s={sources[0]} />}
            </>
          )}
          trailing={buttons.map((b) => button[b])} />
      </Swipe>
      {contesting && (
        <div className="wk-contest-form">
          <textarea autoFocus rows={2} value={note} aria-label="Why this claim is wrong" placeholder="What is wrong or out of date? Link a source if you have one." onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setContesting(false); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) contest(); }} />
          <div className="wk-contest-btns">
            <button className="btn" onClick={() => setContesting(false)}>Cancel</button>
            <button className="btn primary" onClick={contest}>Contest</button>
          </div>
        </div>
      )}
      {c?.note && <div className="wk-contest-note">{c.note}</div>}
      {old.map((o) => (
        <div key={o.id} className="wk-old">
          <s>{o.text}</s>
          <span>Replaced {o.at != null ? shortDate(o.at) : ''}</span>
        </div>
      ))}
    </li>
  );
});
