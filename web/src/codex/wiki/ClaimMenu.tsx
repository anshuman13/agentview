import { useRef, type ReactNode } from 'react';
import { chatOf, sourcesOf, type Fact } from '../data/wiki/wiki';
import type { Mentions } from '../data/meetings/mentions';
import { dayLabel } from '../data/dates';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { safeHref } from '../../ui/util';
import { openMeeting, openTask } from '../view';
import { KIND } from './Chips';
import { SOURCE_ICON, shortDate, type ClaimMenuItem } from './shared';

type Props = {
  fact: Fact;
  items: ClaimMenuItem[];
  actions: Record<ClaimMenuItem, () => void>;
  open: boolean;
  setOpen: (open: boolean) => void;
  mentions?: Mentions;
  stale?: boolean;
};

export function ClaimMenu({ fact, items, actions, open, setOpen, mentions, stale }: Props) {
  const more = useRef<HTMLButtonElement>(null);
  const pick = (act: () => void) => () => { setOpen(false); act(); };
  const chat = chatOf(fact);
  const extra = sourcesOf(fact).slice(1).filter((s) => safeHref(s.url));
  const mentioned = mentions ? [...mentions.shown, ...mentions.rest] : [];
  const menuItem: Record<ClaimMenuItem, ReactNode> = {
    edit: <MenuItem key="edit" icon="edit" onClick={pick(actions.edit)}>Edit</MenuItem>,
    cite: <MenuItem key="cite" icon="link" onClick={pick(actions.cite)}>Cite</MenuItem>,
    contest: <MenuItem key="contest" icon="report" onClick={pick(actions.contest)}>Contest</MenuItem>,
    resolve: <MenuItem key="resolve" icon="check" onClick={pick(actions.resolve)}>Resolve</MenuItem>,
    retire: <MenuItem key="retire" icon="archive" danger onClick={pick(actions.retire)}>Retire</MenuItem>,
    restore: <MenuItem key="restore" icon="history" onClick={pick(actions.restore)}>Restore</MenuItem>,
  };
  return (
    <span className="wk-stale-more">
      <IconButton ref={more} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <Menu trigger={more} onClose={() => setOpen(false)}>
          {items.slice(0, -1).map((i) => menuItem[i])}
          {extra.length > 0 && <MenuSeparator />}
          {extra.map((s, i) => <MenuItem key={i} icon={SOURCE_ICON[s.kind]} href={safeHref(s.url)} onClick={() => setOpen(false)}>{KIND[s.kind]}: {s.label}</MenuItem>)}
          {mentioned.length > 0 && <MenuSeparator />}
          {mentioned.map((m) => (
            <MenuItem key={m.kind + m.id} icon={m.kind === 'task' ? 'checklist' : 'calendar'} onClick={pick(() => (m.kind === 'task' ? openTask(m) : openMeeting(m)))}>
              {m.title}{m.at != null && ` ${dayLabel(m.at)}`}
            </MenuItem>
          ))}
          {chat && <MenuSeparator />}
          {chat && <MenuItem icon="sparkle" href={`/?session=${encodeURIComponent(chat)}`} onClick={() => setOpen(false)}>Open Claude chat</MenuItem>}
          {fact.at != null && <MenuSeparator />}
          {fact.at != null && <MenuItem icon="history" disabled>{stale ? 'Still true? ' : ''}Updated {shortDate(fact.at)}</MenuItem>}
          {items.slice(-1).map((i) => menuItem[i])}
        </Menu>
      )}
    </span>
  );
}
