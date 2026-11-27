import type { RefObject } from 'react';
import type { AssistantStore, Snapshot } from './data/store';
import { AssistantNav } from './nav';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { Back } from '../app/touch/back';
import { sheetOpen } from '../ui/Sheet';
import { useEscape, useReturnFocus } from '../ui/util';

export function LockedCodex({ root, snap, store }: { root: RefObject<HTMLDivElement | null>; snap: Pick<Snapshot, 'phase' | 'message'>; store: AssistantStore }) {
  return (
    <div className="assistant locked" ref={root}>
      <Icon name="lock" />
      <div className="as-lock-title">Codex is locked</div>
      <div className="muted">{snap.message === 'Locked' ? 'Your tasks and notes are encrypted on this phone.' : snap.message}</div>
      {snap.phase === 'locked' && <Button variant="primary" size="lg" onClick={() => store.unlock()}>{snap.message === 'Locked' ? 'Unlock' : 'Retry'}</Button>}
    </div>
  );
}

export function ListsDrawer({ leaving, leave, close }: { leaving: boolean; leave: () => void; close: () => void }) {
  useReturnFocus();
  useEscape(() => { if (!sheetOpen()) leave(); });
  return (
    <div className={`as-drawer-overlay ${leaving ? 'leaving' : ''}`} onClick={leave} onAnimationEnd={(e) => leaving && e.target === e.currentTarget && close()}>
      <Back close={leave} />
      <div className="as-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="as-drawer-title">Codex</div>
        <AssistantNav onPick={leave} />
      </div>
    </div>
  );
}
