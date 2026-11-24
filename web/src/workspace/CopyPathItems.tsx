import { useRef } from 'react';
import { notice } from '../app/store';
import { Menu, MenuItem } from '../ui/Menu';
import { copyText } from '../ui/util';
import { pathCopies } from './copyPathLogic';

export function CopyPathItems({ path, cwd, onDone }: { path: string; cwd: string; onDone?: () => void }) {
  const { absolute, relative, name } = pathCopies(path, cwd);
  const copy = (text: string, done: string) => () => {
    onDone?.();
    copyText(text).then(() => notice(done), () => notice('Copy failed'));
  };
  return (
    <>
      <MenuItem icon="copy" onClick={copy(absolute, 'Path copied')}>Copy path</MenuItem>
      {relative !== null && <MenuItem icon="copy" onClick={copy(relative, 'Relative path copied')}>Copy relative path</MenuItem>}
      <MenuItem icon="copy" onClick={copy(name, 'Name copied')}>Copy name</MenuItem>
    </>
  );
}

export type MenuPoint = { path: string; x: number; y: number };

// A right-click menu at the pointer. The anchor is a fixed point, so a re-render of what was clicked cannot move it.
export function CopyPathMenu({ path, cwd, at, onClose }: { path: string; cwd: string; at: { x: number; y: number }; onClose: () => void }) {
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchor} className="ui-menu-anchor" style={{ left: at.x, top: at.y }}>
      <Menu trigger={anchor} onClose={onClose}>
        <CopyPathItems path={path} cwd={cwd} onDone={onClose} />
      </Menu>
    </div>
  );
}
