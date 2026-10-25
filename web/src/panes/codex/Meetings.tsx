import { Icon } from '../../Icon';

export function Meetings({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="as-head">
      <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
      <h1>Meetings</h1>
    </header>
  );
}
