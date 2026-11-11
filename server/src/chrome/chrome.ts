import type { Peer } from '../http/peer.js';
import { call, connect, connected, events, sendState, setup, stopRetrying, type Msg } from './cdp.js';
import { chromeRunning, endpoint, launchProfile, openMac, ownProfile } from './launch.js';
import { forgetViewer, frame, hooks, resetFrames, viewers, viewport } from './frames.js';
import { forgetTouch, pageInput, viewerSize } from './input.js';
import { pick, selectTab } from './pick.js';
import { dropEmulation, emulate, forgetSize, resize, snapshot, stopWatching } from './screencast.js';
import { sendTabs, tabs, track, trustOrigin, view } from './tabs.js';

export { chromeRunning, endpoint, ownProfile, viewers, hooks, resetFrames, frame, connect };

export function openInChrome(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (ownProfile() && connected()) {
    call('Target.createTarget', { url })
      .then(({ targetId }) => call('Target.activateTarget', { targetId }))
      .catch(() => launchProfile(url));
    return;
  }
  if (ownProfile()) return launchProfile(url);
  openMac('open in chrome', process.platform === 'darwin' ? ['-a', 'Google Chrome', url] : [url]);
}

events.opened = async () => {
  await call('Target.setDiscoverTargets', { discover: true });
  const { targetInfos } = await call('Target.getTargets');
  targetInfos.forEach((t: any) => track(t, false));
  pick();
};

events.closed = () => {
  view.watching = null;
  dropEmulation();
  tabs.clear();
  sendTabs();
};

function onTargetDestroyed(targetId: string) {
  tabs.delete(targetId);
  if (view.pinned === targetId) view.pinned = null;
  if (view.watching?.target === targetId) view.watching = null;
  pick();
}

events.message = (m: Msg) => {
  switch (m.method) {
    case 'Target.targetCreated':
    case 'Target.targetInfoChanged':
      if (track(m.params.targetInfo, true)) pick();
      else sendTabs();
      break;
    case 'Target.targetDestroyed':
      onTargetDestroyed(m.params.targetId);
      break;
    case 'Page.screencastVisibilityChanged':
      if (m.sessionId === view.watching?.session && !m.params.visible && !view.pinned) pick();
      break;
    case 'Page.screencastFrame':
      if (m.sessionId !== view.watching?.session) return;
      Object.assign(viewport, { w: m.params.metadata.deviceWidth, h: m.params.metadata.deviceHeight });
      frame(m.params.data, { session: m.sessionId, id: m.params.sessionId });
      break;
  }
};

hooks.ack = ({ session, id }) => void call('Page.screencastFrameAck', { sessionId: id }, session).catch(() => {});

async function input(m: any, ws: Peer) {
  switch (m.t) {
    case 'connect':
      return connect();
    case 'setup':
      return setup();
    case 'tab':
      return selectTab(m.id);
    case 'size': {
      const { size, dims } = viewerSize(m);
      return resize(ws, size, dims);
    }
  }
  const s = view.watching?.session;
  if (s) return pageInput(m, ws, s);
}

function closeViewer(ws: Peer) {
  viewers.delete(ws);
  forgetTouch(ws);
  forgetViewer(ws);
  const was = forgetSize(ws);
  if (!viewers.size) {
    stopRetrying();
    return stopWatching();
  }
  if (was) void emulate();
}

export function openChrome(ws: Peer, origin: string | undefined) {
  if (origin) trustOrigin(origin);
  viewers.add(ws);
  sendState(ws);
  if (connected()) {
    pick();
    void snapshot().catch(() => {});
  } else void connect();
  ws.on('message', (raw) => {
    let m: unknown;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    input(m, ws).catch((err) => console.error('chrome input:', err.message));
  });
  ws.on('close', () => closeViewer(ws));
}
