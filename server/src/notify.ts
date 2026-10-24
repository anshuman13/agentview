import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LiveChat, ServerMessage } from '../../shared/protocol.js';

const last = new Map<string, number>();
const FIFO = path.join(os.homedir(), '.agentview/notify.fifo');
const OBSERVE = path.join(os.homedir(), '.agentview/observe.json');
const APP = 'http://localhost:5173';

function detail(m: ServerMessage) {
  if (m.type === 'pending') return m.request.kind === 'question' ? m.request.questions[0]?.question ?? 'Claude has a question' : m.request.title;
  if (m.type === 'event' && m.event.kind === 'result') return m.event.text.trim().split('\n')[0] || 'Turn ended';
  return null;
}

export function notifyAway(m: ServerMessage, away: () => LiveChat | null) {
  const body = detail(m);
  if (body === null) return;
  const chat = away();
  if (!chat || Date.now() - (last.get(chat.id) ?? 0) < 30_000) return;
  last.set(chat.id, Date.now());
  const title = `Claude ${m.type === 'pending' ? 'needs you' : 'finished'} in ${path.basename(chat.cwd)}`;
  post(title, chat.title, body.slice(0, 200), `${APP}/?chat=${chat.id}`);
}

// The menu bar app opens url when the notification is clicked; the osascript fallback has no click action.
export function post(title: string, subtitle: string, body: string, url = `${APP}/?view=chats`) {
  void pushNtfy(title, subtitle, body, url);
  if (process.platform !== 'darwin') return;
  try {
    const fd = fs.openSync(FIFO, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    try {
      fs.writeSync(fd, JSON.stringify({ title, subtitle, body, url }) + '\n');
    } finally {
      fs.closeSync(fd);
    }
    return;
  } catch {}
  const script = 'display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv) sound name "Glass"';
  execFile('osascript', ['-e', 'on run argv', '-e', script, '-e', 'end run', title, subtitle, body], () => {});
}

export const STALL_MS = 15 * 60_000;

// Running chats that send nothing for a while are reported once; the mark goes at their next message.
export function stallWatch(onStall: (id: string) => void, every = 60_000) {
  const at = new Map<string, number>();
  const stalled = new Set<string>();
  setInterval(() => {
    for (const [id, t] of at) {
      if (stalled.has(id) || Date.now() - t < STALL_MS) continue;
      stalled.add(id);
      onStall(id);
    }
  }, every).unref();
  return {
    // Returns true when the chat was marked stalled until now.
    seen(id: string, running: boolean) {
      if (running) at.set(id, Date.now());
      else at.delete(id);
      return stalled.delete(id);
    },
    stalled: (id: string) => stalled.has(id),
  };
}

export function notifyStall(chat: LiveChat) {
  post(`Claude is quiet in ${path.basename(chat.cwd)}`, chat.title, `No activity for ${STALL_MS / 60_000} minutes`, `${APP}/?chat=${chat.id}`);
}

// A topic name on ntfy.sh or a full URL, from the environment or the ntfy key in observe.json.
async function ntfyUrl() {
  const topic = process.env.AGENTVIEW_NTFY || (await readFile(OBSERVE, 'utf8').then((raw) => String(JSON.parse(raw).ntfy ?? '')).catch(() => ''));
  if (!topic) return null;
  return /^https?:\/\//.test(topic) ? topic : `https://ntfy.sh/${encodeURIComponent(topic)}`;
}

// HTTP header values must be ASCII; ntfy accepts RFC 2047 for the rest.
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);

export async function pushNtfy(title: string, subtitle: string, body: string, url: string) {
  const to = await ntfyUrl();
  if (!to) return false;
  await fetch(to, { method: 'POST', headers: { Title: header(title), Click: url }, body: [subtitle, body].filter(Boolean).join('\n') }).catch(() => {});
  return true;
}
