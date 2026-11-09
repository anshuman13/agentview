import { Suspense } from 'react';
import { Brief, Loading, Terminal } from '../lazy';
import { Offline, Restarting } from './StatusItems';
import { SwitchedBanner } from './macName';
import type { Tab } from './TabBar';

export function EmbeddedApp() {
  return (
    <div className="workbench embed" data-tab="chat" data-sidebar="false" data-chat="true" data-editor="false">
      <SwitchedBanner />
      <Restarting />
      <Offline />
      <div className="body"><section className="main pane center"><Suspense fallback={<Loading />}><Brief /></Suspense></section></div>
    </div>
  );
}

type PanelProps = { chat: string; project: string | undefined; height: number; open: boolean; tab: Tab; startResize: (e: React.PointerEvent) => void; toggle: () => void };

export function TerminalPanel({ chat, project, height, open, tab, startResize, toggle }: PanelProps) {
  return (
    <div className="panel" style={open ? { height } : undefined}>
      {open && <div className="panel-sash" onPointerDown={startResize} />}
      <Suspense fallback={null}><Terminal key={chat} chat={chat} project={project} open={open || tab === 'term'} onToggle={() => tab !== 'term' && toggle()} /></Suspense>
    </div>
  );
}
