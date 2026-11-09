import { useRef, useState } from 'react';
import { useCodex } from '../../data';
import { rowKey } from '../../data/sync';
import { MEETING_CHIPS, type MeetingChip } from '../../data/meetings/meetings';
import { newNotes } from './newNotes';
import { IconButton } from '../../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../../ui/Menu';
import { setView, showSnack, useView } from '../../view';
import { useSnackTask } from '../../tasks/useSnackTask';

export type ListMode = '' | 'log' | 'load' | 'week';

const MODES: [Exclude<ListMode, ''>, string, string][] = [['log', 'Decisions', 'check'], ['load', 'Load', 'graph'], ['week', 'Week', 'calendar']];

type Props = { mode: ListMode; setMode: (m: ListMode) => void; chips: MeetingChip[]; toggleChip: (c: MeetingChip) => void; trackTopic: () => void };

export function ListMenu({ mode, setMode, chips, toggleChip, trackTopic }: Props) {
  const { store } = useCodex();
  const { filter } = useView();
  const [menu, setMenu] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [syncing, runSync] = useSnackTask();
  const pick = (act: () => void) => () => { setMenu(false); act(); };
  const takeNotes = () => {
    const row = newNotes(filter === 'personal' ? 'personal' : 'work');
    void store.editRow('meetings', row, { title: 'Notes', starts_at: row.starts_at, notes: '' });
    setView({ open: rowKey(row) });
  };
  const syncCalendar = () => runSync(async () => {
    const n = await store.syncCalendar();
    showSnack(n ? `${n} meeting${n > 1 ? 's' : ''} updated from the calendar` : 'Calendar is up to date');
  }, 'Calendar sync failed');
  return (
    <span className="mt-head-more">
      <IconButton ref={moreBtn} size="sm" icon="kebab-vertical" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
      {menu && (
        <Menu trigger={moreBtn} onClose={() => setMenu(false)}>
          {MODES.map(([m, label, icon]) => <MenuItem key={m} icon={mode === m ? 'check' : icon} onClick={pick(() => setMode(mode === m ? '' : m))}>{label}</MenuItem>)}
          <MenuItem icon="edit" onClick={pick(takeNotes)}>Take notes</MenuItem>
          <MenuItem icon={syncing ? 'loading' : 'sync'} spin={syncing} disabled={syncing} onClick={pick(syncCalendar)}>Sync calendar</MenuItem>
          <MenuSeparator />
          {MEETING_CHIPS.map((c) => <MenuItem key={c} role="menuitemcheckbox" aria-checked={chips.includes(c)} icon={chips.includes(c) ? 'check' : undefined} onClick={pick(() => toggleChip(c))}>{c}</MenuItem>)}
          <MenuSeparator />
          <MenuItem onClick={pick(trackTopic)}>Track a topic</MenuItem>
        </Menu>
      )}
    </span>
  );
}
