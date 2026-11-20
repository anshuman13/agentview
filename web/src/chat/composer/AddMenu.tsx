import { useRef, useState } from 'react';
import { useStore } from '../../app/store';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { plural } from '../../ui/util';
import type { Pick } from '../ChatSettings';
import { useCan } from '../useCan';
import { useModeText } from './ComposerFoot';

type AddMenuProps = { uploading: number; setPick: (p: Pick) => void; attach: (list: File[]) => Promise<void> };

export function AddMenu({ uploading, setPick, attach }: AddMenuProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const canMcp = useCan('mcp');
  const canBuild = useCan('build');
  const connected = useStore((s) => s.session.mcp).some((m) => m.status === 'connected');
  const modeText = useModeText();
  const pickAt = (kind: Pick['kind']) => () => {
    setOpen(false);
    setPick({ kind, at: trigger.current!.getBoundingClientRect() });
  };
  return (
    <div className="cp-add">
      <input ref={picker} type="file" multiple hidden onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <IconButton
        ref={trigger}
        icon={uploading > 0 ? 'loading' : 'add'}
        spin={uploading > 0}
        label="Add"
        title={uploading > 0 ? `Uploading ${plural(uploading, 'file')}…` : 'Add files, MCP servers or change the model and mode'}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <Menu trigger={trigger} onClose={() => setOpen(false)}>
          <MenuItem icon="file-add" onClick={() => { setOpen(false); picker.current?.click(); }}>Add files</MenuItem>
          {canMcp && connected && <MenuItem icon="plug" onClick={pickAt('mcp')}>Use an MCP server</MenuItem>}
          {canBuild && <MenuItem icon="tools" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('agentview:build')); }}>Build the brief</MenuItem>}
          <MenuItem icon="settings-gear" onClick={pickAt('menu')}>Model and mode · {modeText}</MenuItem>
        </Menu>
      )}
    </div>
  );
}
