import { useRef, useState } from 'react';
import { IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { command, plural } from '../../ui/util';
import { send, useStore } from '../../app/store';
import { composerConnectors } from '../../../../shared/composerConnectors';
import { useCan } from '../useCan';
import type { Pick } from '../ChatSettings';
import { useModeText } from './ComposerFoot';

type AddMenuProps = { uploading: number; setPick: (p: Pick) => void; attach: (list: File[]) => Promise<void> };

export function AddMenu({ uploading, setPick, attach }: AddMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'connectors'>('main');
  const mcp = useStore((s) => s.session.mcp);
  const canMcp = useCan('mcp');
  const canEdit = useCan('mcpEdit');
  const rows = composerConnectors(mcp ?? []);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement>(null);
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
        title={uploading > 0 ? `Uploading ${plural(uploading, 'file')}…` : 'Add files or change the model and mode'}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => { setView('main'); setOpen((v) => !v); }}
      />
      {open && view === 'main' && (
        <Menu trigger={trigger} onClose={() => setOpen(false)}>
          <MenuItem icon="file-add" onClick={() => { setOpen(false); picker.current?.click(); }}>Add files</MenuItem>
          <MenuItem icon="settings-gear" onClick={pickAt('menu')}>Model and mode · {modeText}</MenuItem>
          {canMcp && rows.length > 0 && <MenuItem icon="plug" onClick={() => setView('connectors')}>Connectors · {rows.filter((r) => r.on).length} on<span className="spacer" /><Icon name="chevron-right" small /></MenuItem>}
        </Menu>
      )}
      {open && view === 'connectors' && (
        <Menu key="connectors" trigger={trigger} onClose={() => setOpen(false)} className="cp-conns">
          <MenuItem icon="arrow-left" onClick={() => setView('main')}>Connectors</MenuItem>
          <MenuSeparator />
          {rows.map((r) => (
            <MenuItem key={r.name} role="menuitemcheckbox" aria-checked={r.on} disabled={!canEdit} title={r.note || undefined} onClick={() => send({ type: 'mcp_toggle', name: r.name, enabled: !r.on })}>
              <span className={`dot ${r.tone}`} />
              <span className="cp-conn-name">{r.label}</span>
              {r.note && r.on && <span className="muted">{r.note}</span>}
              <span className={`cp-switch${r.on ? ' on' : ''}`} aria-hidden><span /></span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon="settings-gear" onClick={() => { setOpen(false); command('page:mcp'); }}>Manage</MenuItem>
        </Menu>
      )}
    </div>
  );
}
