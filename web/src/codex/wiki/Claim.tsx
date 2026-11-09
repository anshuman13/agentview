import { memo, useRef, useState, type ReactNode } from 'react';
import { useAssistantStore } from '../data';
import { chatOf, contestOf, sourcesOf, type Fact } from '../data/wiki/wiki';
import type { Mentions } from '../data/meetings/mentions';
import { dayLabel } from '../data/dates';
import { Button, IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { ago, safeHref } from '../../ui/util';
import { copyText, openMeeting, openTask, showSnack } from '../view';
import { Swipe } from '../gestures/Swipe';
import { KIND, SourceChip } from './Chips';
import { useReview } from './Review';
import { actionsFor, SOURCE_ICON, shortDate, type ClaimButton, type ClaimMenuItem } from './shared';

export const Claim = memo(function Claim({ fact, old, page, flash, mentions, stale }: { fact: Fact; old: Fact[]; page: string; flash: boolean; mentions?: Mentions; stale?: boolean }) {
  const store = useAssistantStore();
  const review = useReview();
  const proposed = fact.state === 'proposed';
  const [contesting, setContesting] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
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
    copyText(text, 'Claim copied');
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
  const chat = chatOf(fact);
  const sources = sourcesOf(fact);
  const extra = sources.slice(1).filter((s) => safeHref(s.url));
  const mentioned = mentions ? [...mentions.shown, ...mentions.rest] : [];
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
        {menu && (
          <Menu trigger={more} onClose={() => setMenu(false)}>
            {items.slice(0, -1).map((i) => menuItem[i])}
            {extra.length > 0 && <MenuSeparator />}
            {extra.map((s, i) => <MenuItem key={i} icon={SOURCE_ICON[s.kind]} href={safeHref(s.url)} onClick={() => setMenu(false)}>{KIND[s.kind]}: {s.label}</MenuItem>)}
            {mentioned.length > 0 && <MenuSeparator />}
            {mentioned.map((m) => (
              <MenuItem key={m.kind + m.id} icon={m.kind === 'task' ? 'checklist' : 'calendar'} onClick={pick(() => (m.kind === 'task' ? openTask(m) : openMeeting(m)))}>
                {m.title}{m.at != null && ` ${dayLabel(m.at)}`}
              </MenuItem>
            ))}
            {chat && <MenuSeparator />}
            {chat && <MenuItem icon="sparkle" href={`/?session=${encodeURIComponent(chat)}`} onClick={() => setMenu(false)}>Open Claude chat</MenuItem>}
            {fact.at != null && <MenuSeparator />}
            {fact.at != null && <MenuItem icon="history" disabled>{stale ? 'Still true? ' : ''}Updated {shortDate(fact.at)}</MenuItem>}
            {items.slice(-1).map((i) => menuItem[i])}
          </Menu>
        )}
      </span>
    ),
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
