import type { RefObject } from 'react';
import type { Fact, Page } from '../data/wiki/wiki';
import { hasLiveClaims, wikiMarkdown } from '../data/wiki/wikiMarkdown';
import { Button, IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { Section } from '../../ui/Section';
import { copyText, setView } from '../view';
import { REVIEW } from './shared';

type Props = {
  page: Page;
  isMemory: boolean;
  groups: Parameters<typeof wikiMarkdown>[1];
  pending: Fact[];
  renaming: string | null;
  setRenaming: (title: string | null) => void;
  cancelled: RefObject<boolean>;
  onRename: () => void;
  onPropose: () => void;
  menu: boolean;
  setMenu: (open: boolean) => void;
  moreBtn: RefObject<HTMLButtonElement | null>;
  onAsk: () => void;
  onArchive: () => void;
};

export function WikiPageHead({ page, isMemory, groups, pending, renaming, setRenaming, cancelled, onRename, onPropose, menu, setMenu, moreBtn, onAsk, onArchive }: Props) {
  const pick = (run: () => void) => () => { setMenu(false); run(); };
  return (
    <Section
      label={renaming === null ? page.title : <input autoFocus className="wk-rename" aria-label="Page title" value={renaming} onChange={(e) => setRenaming(e.target.value)} onFocus={(e) => e.target.select()} onBlur={onRename}
        onKeyDown={(e) => { if (e.key === 'Enter') onRename(); if (e.key === 'Escape') { e.stopPropagation(); cancelled.current = true; setRenaming(null); } }} />}
      action={
        <span className="as-tt-actions">
          <Button size="sm" variant="filled" icon="add" onClick={onPropose}>Propose claim</Button>
          <span className="wk-stale-more">
            <IconButton ref={moreBtn} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
            {menu && (
              <Menu trigger={moreBtn} onClose={() => setMenu(false)}>
                {!isMemory && <MenuItem icon="sparkle" onClick={pick(onAsk)}>Ask</MenuItem>}
                {!isMemory && <MenuItem icon="edit" onClick={pick(() => { cancelled.current = false; setRenaming(page.title ?? ''); })}>Rename</MenuItem>}
                {pending.length > 0 && <MenuItem icon="checklist" onClick={pick(() => setView({ open: REVIEW, anchor: null }))}>Review</MenuItem>}
                {hasLiveClaims(groups) && <MenuItem icon="copy" onClick={pick(() => copyText(wikiMarkdown(page.title, groups)))}>Copy as Markdown</MenuItem>}
                {!isMemory && <MenuSeparator />}
                {!isMemory && <MenuItem icon="archive" danger onClick={pick(onArchive)}>Archive</MenuItem>}
              </Menu>
            )}
          </span>
        </span>
      }
    />
  );
}
