import type { RefObject } from 'react';
import type { AssistantStore, Snapshot } from './data/store';
import { AssistantNav } from './nav';
import { Icon } from '../ui/Icon';
import { Back } from '../app/touch/back';

export function LockedCodex({ root, snap, store }: { root: RefObject<HTMLDivElement | null>; snap: Pick<Snapshot, 'phase' | 'message'>; store: AssistantStore }) {
  return (
    <div className="assistant locked" ref={root}>
      <Icon name="lock" />
      <div className="as-lock-title">Codex is locked</div>
      <div className="muted">{snap.message === 'Locked' ? 'Your tasks and notes are encrypted on this phone.' : snap.message}</div>
      {snap.phase === 'locked' && <button className="btn primary lg" onClick={() => store.unlock()}>{snap.message === 'Locked' ? 'Unlock' : 'Retry'}</button>}
    </div>
  );
}

export function ListsDrawer({ close }: { close: () => void }) {
  return (
    <div className="as-drawer-overlay" onClick={close}>
      <Back close={close} />
      <div className="as-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="as-drawer-title">Codex</div>
        <AssistantNav onPick={close} />
      </div>
    </div>
  );
}
