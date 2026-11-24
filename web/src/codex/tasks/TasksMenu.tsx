import { useRef, useState } from 'react';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';

export function TasksMenu({ onSearch, onSelect }: { onSearch: () => void; onSelect: () => void }) {
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const pick = (act: () => void) => () => { setOpen(false); act(); };
  return (
    <>
      <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <Menu trigger={more} onClose={() => setOpen(false)}>
          <MenuItem icon="search" onClick={pick(onSearch)}>Search tasks</MenuItem>
          <MenuItem icon="tasklist" onClick={pick(onSelect)}>Select tasks</MenuItem>
        </Menu>
      )}
    </>
  );
}
