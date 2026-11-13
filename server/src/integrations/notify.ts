import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson } from '../json.js';
import type { ChatRun, LiveChat, RoundOutcome, ServerMessage } from '../../../shared/protocol.js';
import { stripRound } from '../../../shared/edits.js';
import { providerLabel } from '../../../shared/providers.js';

const last = new Map<string, { at: number; key: string }>();
const FIFO = path.join(os.homedir(), '.agentview/notify.fifo');
const OBSERVE = path.join(os.homedir(), '.agentview/observe.json');
export const APP = 'http://localhost:7777';

function detail(m: ServerMessage) {
  if (m.type === 'pending') return m.request.kind === 'question' ? m.request.questions[0]?.question ?? 'The agent has a question' : m.request.title;
  if (m.type === 'event' && m.event.kind === 'result') return stripRound(m.event.text).trim().split('\n')[0] || 'Turn ended';
  return null;
}

// A loop or goal round pushes only when it needs the user or ended the work.
const ROUND_PUSH: Partial<Record<RoundOutcome, string>> = { done: 'done', blocked: 'blocked', question: 'question', failed: 'failed' };

// With a desktop client active in the last 3 minutes the menu bar notification still shows but the ntfy push is skipped.
export function notifyAway(m: ServerMessage, away: () => LiveChat | null, desktopActive: () => boolean = () => false, round: { outcome: RoundOutcome; line: string; goal?: boolean; ends?: boolean } | null = null) {
  const body = detail(m);
  if (body === null) return;
  const ended = m.type === 'event' ? round : null;
  const word = ended && ROUND_PUSH[ended.outcome];
  if (ended && (!word || ended.ends)) return;
  const chat = away();
  if (!chat) return;
  const kind = m.type === 'pending' ? 'needs' : 'finished';
  const key = m.type === 'pending' ? `needs:${m.request.id}` : kind;
  const prev = last.get(`${chat.id}:${kind}`);
  if (prev && prev.key === key && Date.now() - prev.at < 30_000) return;
  last.set(`${chat.id}:${kind}`, { at: Date.now(), key });
  const title = word ? `${ended?.goal ? 'Goal' : 'Loop'} in ${path.basename(chat.cwd)}: ${word}` : `${providerLabel(chat.provider)} ${m.type === 'pending' ? 'needs you' : 'finished'} in ${path.basename(chat.cwd)}`;
  post(title, chat.title, (ended?.line || body).split(/(?<=[.!?])\s|\n/)[0].slice(0, 200), `${APP}/?chat=${chat.id}`, !desktopActive());
}

// Whether the push went out; the same slug in the same chat within 30 s is skipped.
export function notifyApproval(chat: LiveChat, slug: string, title: string, body: string) {
  const prev = last.get(`${chat.id}:approval`);
  if (prev && prev.key === `approval:${slug}` && Date.now() - prev.at < 30_000) return false;
  last.set(`${chat.id}:approval`, { at: Date.now(), key: `approval:${slug}` });
  post(`Approve ${title}?`, chat.title, body, `${APP}/?chat=${chat.id}&slug=${encodeURIComponent(slug)}`);
  return true;
}

export function notifyRunEnded(run: ChatRun, repo: string, push: boolean) {
  const kind = run.kind === 'cycle' ? 'Build cycle' : run.kind === 'tries' ? 'Tries' : 'Loop';
  const title = run.kind === 'goal' ? (/^Goal met/.test(run.why) ? 'Goal met' : /^Not met/.test(run.why) ? 'Goal not met' : 'Goal stopped') : `${kind} ended`;
  post(`${title}${repo ? ` in ${repo}` : ''}`, run.title, run.why, `${APP}/?view=runs`, push);
}

// The menu bar app shows the notification and opens url when it is clicked. Without it only the ntfy push goes out.
export function post(title: string, subtitle: string, body: string, url = `${APP}/?view=chats`, push = true) {
  if (push) void pushNtfy(title, subtitle, body, url);
  if (process.platform !== 'darwin') return;
  try {
    const fd = fs.openSync(FIFO, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    try {
      fs.writeSync(fd, JSON.stringify({ title, subtitle, body, url }) + '\n');
    } finally {
      fs.closeSync(fd);
    }
  } catch {}
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
  post(`${providerLabel(chat.provider)} is quiet in ${path.basename(chat.cwd)}`, chat.title, `No activity for ${STALL_MS / 60_000} minutes`, `${APP}/?chat=${chat.id}`);
}

// A topic name on ntfy.sh or a full URL, from the environment or the ntfy key in observe.json. Off without either.
export async function ntfyTopic() {
  if (process.env.AGENTVIEW_NTFY) return process.env.AGENTVIEW_NTFY;
  const cfg = await readJson<any>(OBSERVE, {});
  return typeof cfg?.ntfy === 'string' && cfg.ntfy ? cfg.ntfy : 'off';
}

async function ntfyUrl() {
  const topic = await ntfyTopic();
  if (topic === 'off') return null;
  return /^https?:\/\//.test(topic) ? topic : `https://ntfy.sh/${encodeURIComponent(topic)}`;
}

// HTTP header values must be ASCII; ntfy accepts RFC 2047 for the rest.
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);

export async function pushNtfy(title: string, subtitle: string, body: string, url: string, actions = '') {
  const to = await ntfyUrl();
  if (!to) return false;
  return fetch(to, { method: 'POST', headers: { Title: header(title), ...(url ? { Click: url } : {}), ...(actions ? { Actions: header(actions) } : {}) }, body: [subtitle, body].filter(Boolean).join('\n'), signal: AbortSignal.timeout(10_000) })
    .then((r) => r.ok)
    .catch(() => false);
}
