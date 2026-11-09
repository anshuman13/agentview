import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { chromeRunning, endpoint, failure, launchProfile, openMac, ownProfile } from './launch.js';
import { viewers } from './frames.js';
import { errText } from '../../../shared/util.js';

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
let nextId = 1;
const calls = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
let retryTimer: NodeJS.Timeout | null = null;
let retryDelay = 2000;
let fastUntil = 0;
const RETRY = new Set(['disabled', 'nochrome', 'closed', 'nofda']);

export const connected = () => cdp !== null;

export function broadcast(m: object) {
  const s = JSON.stringify(m);
  viewers.forEach((v) => v.readyState === WebSocket.OPEN && v.send(s));
}

export function sendState(ws: WebSocket) {
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
  return new Promise((resolve, reject) => {
    if (!cdp || cdp.readyState !== WebSocket.OPEN) return reject(new Error('Chrome is not connected'));
    const id = nextId++;
    const timer = setTimeout(() => {
      calls.delete(id);
      reject(new Error(`${method} timed out`));
    }, ms);
    calls.set(id, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    cdp.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

function answer(m: Msg) {
  const c = calls.get(m.id!);
  calls.delete(m.id!);
  if (m.error) c?.reject(new Error(m.error.message));
  else c?.resolve(m.result);
}

function onMessage(m: Msg) {
  if (m.id) answer(m);
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
    ws = new WebSocket(url, { maxPayload: 512 * 1024 * 1024, handshakeTimeout: 60000 });
  } catch {
    // A half-written port file gives a URL the constructor rejects; without this the state stays connecting for good.
    return setState('off', 'disabled');
  }
  let failed: Promise<string> | null = null;
  ws.on('open', async () => {
    cdp = ws;
    retryDelay = 2000;
    setState('on');
    try {
      await events.opened();
    } catch (err) {
      console.error('chrome:', err);
    }
  });
  ws.on('message', (raw) => {
    try {
      onMessage(JSON.parse(String(raw)));
    } catch (err) {
      console.error('chrome message:', err);
    }
  });
  ws.on('error', (err: NodeJS.ErrnoException) => {
    failed ??= failure(err);
  });
  ws.on('close', async () => {
    const was = cdp === ws;
    cdp = null;
    calls.forEach((c) => c.reject(new Error('Chrome disconnected')));
    calls.clear();
    events.closed();
    setState('off', was ? 'closed' : ((await failed) ?? 'closed'));
  });
}
