import { memo, useRef, useState, type ReactNode } from 'react';
import { useAssistantStore } from '../data';
import { chatOf, contestOf, sourcesOf, type Fact } from '../data/wiki';
import type { Mentions } from '../data/mentions';
import { dayLabel } from '../data/dates';
import { Button, Chip, IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Menu, MenuItem } from '../../ui/Menu';
import { ago } from '../../ui/util';
import { openMeeting, openTask, showSnack } from '../view';
import { Swipe } from '../Swipe';
import { ClaudeChip, SourceChip } from './Chips';
import { useReview } from './Review';
import { actionsFor, shortDate, type ClaimButton, type ClaimMenuItem } from './shared';

export const Claim = memo(function Claim({ fact, old, page, flash, mentions, stale }: { fact: Fact; old: Fact[]; page: string; flash: boolean; mentions?: Mentions; stale?: boolean }) {
  const store = useAssistantStore();
  const review = useReview();
  const proposed = fact.state === 'proposed';
  const [contesting, setContesting] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [moreMentions, setMoreMentions] = useState(false);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const c = contestOf(fact);
  const startEdit = () => { setDraft(fact.text ?? ''); setEditing(true); };
  const save = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === fact.text) return;
    const prev = fact.text;
    void store.editRow('facts', fact, { text: next });
    showSnack('Claim updated', () => void store.editRow('facts', fact, { text: prev }));
  };
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
  const confirm = () => {
    const prev = fact.at;
    void store.editRow('facts', fact, { at: Date.now() });
    showSnack('Claim confirmed', () => void store.editRow('facts', fact, { at: prev }));
  };
  const retire = () => { void store.editRow('facts', fact, { state: 'retired' }); showSnack('Claim retired', () => void store.editRow('facts', fact, { state: null })); };
  const { buttons, menu: items } = actionsFor(fact, { stale, editing, contesting });
  const restore = () => { void store.editRow('facts', fact, { state: null }); showSnack('Claim restored', () => void store.editRow('facts', fact, { state: 'retired' })); };
  const pick = (act: () => void) => () => { setMenu(false); act(); };
  const menuItem: Record<ClaimMenuItem, ReactNode> = {
    edit: <MenuItem key="edit" icon="edit" onClick={pick(startEdit)}>Edit</MenuItem>,
    cite: <MenuItem key="cite" icon="link" onClick={pick(cite)}>Cite</MenuItem>,
    contest: <MenuItem key="contest" icon="report" onClick={pick(() => setContesting(true))}>Contest</MenuItem>,
    resolve: <MenuItem key="resolve" icon="check" onClick={pick(resolve)}>Resolve</MenuItem>,
    retire: <MenuItem key="retire" icon="archive" danger onClick={pick(retire)}>Retire</MenuItem>,
    restore: <MenuItem key="restore" icon="history" onClick={pick(restore)}>Restore</MenuItem>,
  };
  const button: Record<ClaimButton, ReactNode> = {
    reject: <IconButton key="reject" size="sm" icon="close" label="Reject" onClick={() => review.reject([fact])} />,
    approve: <IconButton key="approve" size="sm" icon="check" label="Approve" onClick={() => review.approve([fact])} />,
    confirm: <Button key="confirm" variant="tinted" size="sm" onClick={confirm}>Confirm</Button>,
    more: (
      <span key="more" className="wk-stale-more">
        <IconButton ref={more} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
        {menu && <Menu trigger={more} onClose={() => setMenu(false)}>{items.map((i) => menuItem[i])}</Menu>}
      </span>
    ),
  };
  return (
    <li className={`wk-item${flash ? ' flash' : ''}`} id={`claim-${fact.id}`}>
      <Swipe onRight={proposed ? () => review.approve([fact]) : undefined} onLeft={proposed ? () => review.reject([fact]) : undefined} rightLabel="Approve" leftLabel="Reject" leftIcon="close">
        <Row plain lines={2}
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
              {sourcesOf(fact).map((s, i) => <SourceChip key={i} s={s} />)}
              {mentions && mentions.shown.length > 0 && (
                <span className="wk-mentions">
                  {(moreMentions ? [...mentions.shown, ...mentions.rest] : mentions.shown).map((m) => (
                    <Chip key={m.kind + m.id} size="sm" icon={m.kind === 'task' ? 'checklist' : 'calendar'} title={m.title} onClick={() => (m.kind === 'task' ? openTask(m) : openMeeting(m))}>
                      <span className="wk-mention-title">{m.title}</span>
                      {m.at != null && <span className="wk-mention-day">{dayLabel(m.at)}</span>}
                    </Chip>
                  ))}
                  {!moreMentions && mentions.rest.length > 0 && <Chip size="sm" className="wk-mention-more" onClick={() => setMoreMentions(true)}>+{mentions.rest.length} more</Chip>}
                </span>
              )}
              {chatOf(fact) && <ClaudeChip chat={chatOf(fact)!} />}
              {stale && <span className="chip">Still true?</span>}
              {fact.at != null && <span className="wk-claim-date">{shortDate(fact.at)}</span>}
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
