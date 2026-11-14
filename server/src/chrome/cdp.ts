import { fileURLToPath } from 'node:url';
import type { Peer } from '../http/peer.js';
import { chromeRunning, endpoint, failure, launchProfile, openMac, ownProfile } from './launch.js';
import { viewers } from './frames.js';
import { errText } from '../../../shared/util.js';
import { RpcCalls } from '../rpcCalls.js';

type State = 'off' | 'connecting' | 'on';
export type Msg = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };

export const events = {
  opened: async () => {},
  message: (_: Msg) => {},
  closed: () => {},
};

let cdp: WebSocket | null = null;
let state: State = 'off';
let reason = '';
const calls = new RpcCalls();
let retryTimer: NodeJS.Timeout | null = null;
let retryDelay = 2000;
let fastUntil = 0;
const RETRY = new Set(['disabled', 'nochrome', 'closed', 'nofda']);

export const connected = () => cdp !== null;

export function broadcast(m: object) {
  const s = JSON.stringify(m);
  viewers.forEach((v) => v.readyState === WebSocket.OPEN && v.send(s));
}

export function sendState(ws: Peer) {
  ws.send(JSON.stringify({ t: 'state', state, reason, own: ownProfile() }));
}

function retry() {
  if (retryTimer || !viewers.size || !RETRY.has(reason)) return;
  broadcast({ t: 'state', state, reason, retry: true, own: ownProfile() });
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, retryDelay);
  retryDelay = Date.now() < fastUntil ? 1500 : Math.min(retryDelay * 2, 30000);
}

export function stopRetrying() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = 2000;
}

const SETUP_PAGE = 'chrome://inspect/#remote-debugging';

export function setup() {
  fastUntil = Date.now() + 3 * 60_000;
  retryDelay = 1500;
  const run = (...args: string[]) => openMac('chrome setup', args);
  if (ownProfile()) void chromeRunning().then((up) => up || launchProfile());
  else if (process.platform === 'darwin' && reason === 'nofda') {
    run('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
    run('-R', fileURLToPath(new URL('../../../dist/AgentView.app', import.meta.url)));
  } else if (process.platform === 'darwin') run('-a', 'Google Chrome', SETUP_PAGE);
  if (state === 'off') setTimeout(() => void connect(), 1500);
}

function setState(s: State, why = '') {
  state = s;
  reason = why;
  broadcast({ t: 'state', state, reason, own: ownProfile() });
  if (s === 'off') retry();
}

export function call(method: string, params: object = {}, sessionId?: string, ms = 15000): Promise<any> {
  if (!cdp || cdp.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Chrome is not connected'));
  const { id, answer } = calls.start(ms, () => new Error(`${method} timed out`));
  cdp.send(JSON.stringify({ id, method, params, sessionId }));
  return answer;
}

const settle = (m: Msg) => calls.settle(m.id, m.error && new Error(m.error.message), m.result);

function onMessage(m: Msg) {
  if (m.id) settle(m);
  else events.message(m);
}

export async function connect() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (cdp || state === 'connecting') return;
  setState('connecting');
  let url: string;
  try {
    url = await endpoint();
  } catch (err) {
    return setState('off', errText(err));
  }
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    // A half-written port file gives a URL the constructor rejects; without this the state stays connecting for good.
    return setState('off', 'disabled');
  }
  let failed: Promise<string> | null = null;
  // Bun's client has no handshake timeout of its own.
  const handshake = setTimeout(() => {
    failed ??= failure(new Error('handshake has timed out'));
    ws.close();
  }, 60_000);
  ws.addEventListener('open', async () => {
    clearTimeout(handshake);
    cdp = ws;
    retryDelay = 2000;
    setState('on');
    try {
      await events.opened();
    } catch (err) {
      console.error('chrome:', err);
    }
  });
  ws.addEventListener('message', (e) => {
    try {
      onMessage(JSON.parse(String(e.data)));
    } catch (err) {
      console.error('chrome message:', err);
    }
  });
  ws.addEventListener('error', (e) => {
    failed ??= failure(new Error((e as ErrorEvent).message));
  });
  ws.addEventListener('close', async () => {
    clearTimeout(handshake);
    const was = cdp === ws;
    cdp = null;
    calls.failAll(new Error('Chrome disconnected'));
    events.closed();
    setState('off', was ? 'closed' : ((await failed) ?? 'closed'));
  });
}
