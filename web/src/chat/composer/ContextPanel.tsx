import { useEffect, type RefObject } from 'react';
import { send, useStore } from '../../app/store';
import { compact } from '../chatActions';
import { can } from '../capabilitiesLogic';
import { Menu, MenuItem } from '../../ui/Menu';
import { contextPanel } from './composerLogic';

const TONES = ['var(--accent-fill)', 'var(--err)', 'var(--ok)', 'var(--warn)'];
const tone = (t: number | null) => (t === null ? 'var(--border)' : TONES[t] ?? 'var(--fg-muted)');

export function ContextPanel({ trigger, onClose }: { trigger: RefObject<HTMLElement | null>; onClose: () => void }) {
  const s = useStore((st) => st.session);
  const rowsToo = can(s.capabilities, 'contextUsage');
  useEffect(() => { if (rowsToo) send({ type: 'context_usage' }); }, [rowsToo]);
  const panel = contextPanel(rowsToo ? s.contextUsage : null, s.context, s.contextWindow);
  if (!panel) return null;
  return (
    <Menu trigger={trigger} onClose={onClose} className="ctx-panel">
      <div className="ctx-head"><span>Context</span><span>{panel.used}</span><span className="ctx-amount">{panel.amount}</span></div>
      <div className="ctx-bar"><span style={{ width: `${panel.fill * 100}%` }} /></div>
      {rowsToo && !s.contextUsage && <div className="ctx-wait">Reading the breakdown…</div>}
      {panel.rows.map((r) => (
        <div key={r.name} className={r.gap ? 'ctx-row gap' : 'ctx-row'}>
          <i style={{ background: tone(r.tone) }} />
          <span>{r.name}</span>
          <span>{r.tokens}</span>
          <span>{r.share}</span>
        </div>
      ))}
      <MenuItem icon="fold" disabled={s.running || s.compacting} onClick={() => { onClose(); compact(); }}>
        {s.compacting ? 'Compacting…' : s.running ? 'Compacts when this turn ends' : 'Compact now'}
      </MenuItem>
    </Menu>
  );
}
