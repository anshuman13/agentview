import { Icon } from '../../Icon';

export function Wiki({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="as-head">
      <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
      <h1>Wiki</h1>
    </header>
  );
}
