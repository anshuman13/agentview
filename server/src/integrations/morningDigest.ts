import { dollars } from '../../../shared/prices.js';
import type { ChatRun } from '../../../shared/protocol.js';
import { APP, pushNtfy } from './notify.js';

const HOUR = 8;
const SINCE_HOUR = 20;
const WINDOW_MS = 10 * 60_000;

const lastAt = (r: ChatRun) => Math.max(r.endedAt ?? 0, r.rounds.at(-1)?.at ?? 0);

// One line per run that ended or got a round since `since`: title, last ROUND line or end note, cost, and whether it needs the user.
export function morningDigest(runs: ChatRun[], since: number) {
  const hit = runs.filter((r) => lastAt(r) >= since);
  if (!hit.length) return null;
  const needs = hit.filter((r) => r.needsYou).length;
  const title = `Overnight: ${hit.length} ${hit.length === 1 ? 'run' : 'runs'}${needs ? `, ${needs} ${needs === 1 ? 'needs' : 'need'} you` : ''}`;
  const body = hit.map((r) => `${r.title}: ${(r.state === 'done' ? r.why : r.rounds.at(-1)?.line) || r.why || r.state}, $${dollars(r.tokens).toFixed(2)}${r.needsYou ? ', needs you' : ''}`).join('\n');
  return { title, body };
}

// 20:00 local on the evening before `now`.
export function eveningBefore(now: Date) {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  d.setHours(SINCE_HOUR, 0, 0, 0);
  return d.getTime();
}

// Sends once a day in the ten minutes from 08:00 local; does nothing without an ntfy topic.
export function startMorningDigest(list: () => ChatRun[], send = pushNtfy, every = 60_000) {
  let sent = '';
  setInterval(() => {
    const now = new Date();
    const day = now.toDateString();
    const start = new Date(now).setHours(HOUR, 0, 0, 0);
    if (sent === day || now.getTime() < start || now.getTime() >= start + WINDOW_MS) return;
    sent = day;
    const digest = morningDigest(list(), eveningBefore(now));
    if (digest) void send(digest.title, '', digest.body, `${APP}/?view=chats`);
  }, every).unref();
}
