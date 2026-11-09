import { getState, notice, prompt, queueNext, send } from '../../../app/store';
import { macOrigin } from '../../../app/api';
import { atTime } from '../tasks/engine';
import type { ItemRow, Profile } from '../sync';
import { currentClaim, factTime, isOld, listOf, live, othersOf, sourcesOf, type Fact, type Meeting, type Page } from '../wiki/wiki';

const line = (r: ItemRow) => {
  const at = atTime(r.at);
  const bits = [r.source && r.source !== 'capture' && r.source, at && `due ${new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`, r.source_url].filter(Boolean);
  return `- [${r.profile}] ${r.title ?? '(untitled)'}${bits.length ? ` (${bits.join(', ')})` : ''}`;
};

const day = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

// What other people said they would do in the last two weeks of meetings, so "what did Kim take on" can be answered.
const othersText = (meetings: Meeting[], now = Date.now()) => live(meetings)
  .filter((m) => m.starts_at && m.starts_at > now - 14 * 86400_000 && m.starts_at < now)
  .flatMap((m) => othersOf(m).map((o) => `- ${day(m.starts_at!)} "${m.title}": ${o.who}: ${o.what}`))
  .slice(0, 80);

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// My personal meetings from the start of today to the end of the third day after, so the chat knows what is planned.
const plansText = (meetings: Meeting[], now = new Date()) => {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 23, 59, 59, 999).getTime();
  const plans = live(meetings)
    .filter((m) => m.profile === 'personal' && m.starts_at != null && m.starts_at >= from && m.starts_at <= to)
    .sort((a, b) => a.starts_at! - b.starts_at!)
    .slice(0, 30)
    .map((m) => `- ${day(m.starts_at!)} ${hhmm(m.starts_at!)} ${m.title}`);
  return `\nMy personal meetings, today and the next 3 days:\n${plans.length ? plans.join('\n') : 'No personal meetings in the next 3 days.'}`;
};

const PERSONAL_WORDS = /\b(trip|travel|train|flight|fly|eurostar|hotel|airbnb|holiday|vacation|ferie|reise|museum|tickets?|restaurant|dinner|birthday|family|kids|weekend|booking|upgrade)\b/i;
const WORK_WORDS = /\b(slack|linear|jira|pr|pull request|oncall|on-call|standup|sprint|deploy|incident|ticket|review|roadmap|okr|oda|team|colleague|1:1)\b/i;
const words = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));

// Work or personal for a question asked with the All filter: travel and private words, or a word shared with a
// personal calendar event in the coming week, mean personal; work words or a shared work meeting word mean work.
export function guessProfile(question: string, meetings: Meeting[], fallback: Profile, now = Date.now()): Profile {
  const q = words(question);
  const near = live(meetings).filter((m) => m.starts_at != null && m.starts_at > now - 86400_000 && m.starts_at < now + 7 * 86400_000);
  const hits = (p: Profile) => near.filter((m) => m.profile === p && [...words(m.title ?? '')].some((w) => q.has(w))).length;
  const personal = (PERSONAL_WORDS.test(question) ? 2 : 0) + hits('personal');
  const work = (WORK_WORDS.test(question) ? 2 : 0) + hits('work');
  return personal > work ? 'personal' : work > personal ? 'work' : fallback;
}

export function askText(question: string, profile: Profile, items: ItemRow[], about?: ItemRow, meetings: Meeting[] = []) {
  const open = items.filter((r) => !r.deleted && r.status === 'open').slice(0, 60);
  const personal = profile === 'personal';
  const others = personal ? [] : othersText(meetings);
  return [
    question,
    about && `\nAbout this item:\n${line(about)}${about.text ? `\n${about.text}` : ''}`,
    open.length ? `\nMy open items in Codex:\n${open.map(line).join('\n')}` : '',
    others.length ? `\nWhat others took on in recent meetings:\n${others.join('\n')}` : '',
    personal ? plansText(meetings) : '\nUse my Slack, Calendar, Gmail and Linear connectors when the question needs them. They are my work accounts: if the question is about my private life (travel, family, personal bookings), do not search them and reply in one line that it belongs in Personal.',
    personal && '\nRead these events in Calendar for location and notes. Then use Calendar, Gmail and web search to suggest concrete alternatives near where I am, each with opening hours and travel time. Change the calendar only after I confirm.',
  ].filter(Boolean).join('\n');
}

type Daily = { day: string; mac: string; chat: string; sessionId: string | null };
const key = (p: Profile) => `codex-chat-${p}`;
const today = () => new Date().toDateString();
const readDaily = (p: Profile): Daily | null => { try { return JSON.parse(localStorage.getItem(key(p)) ?? 'null'); } catch { return null; } };
const saveDaily = (p: Profile, d: Daily) => localStorage.setItem(key(p), JSON.stringify(d));
let asking = false;

// Sends the question to today's Codex chat for the profile on the current Mac. The first question of the day, or fresh, opens a new chat.
export function ask(text: string, profile: Profile, fresh = false) {
  const s = getState();
  if (!s.ui.connected) {
    notice('Not connected to a Mac. The question was not sent.');
    return false;
  }
  if (asking) return false;
  asking = true;
  const mac = macOrigin();
  const d = readDaily(profile);
  const reuse = !fresh && d?.day === today() && d.mac === mac ? d : null;
  const open = reuse && s.live.find((c) => c.id === reuse.chat || (reuse.sessionId != null && c.sessionId === reuse.sessionId));
  const from = s.session.id;
  let ready: (id: string) => boolean;
  if (open) {
    if (from !== open.id) send({ type: 'view', id: open.id });
    ready = (id) => id === open.id;
  } else {
    send(reuse?.sessionId ? { type: 'open_session', sessionId: reuse.sessionId } : { type: 'new_session', profile });
    ready = (id) => !!id && id !== from;
  }
  const started = Date.now();
  const t = setInterval(() => {
    const { session } = getState();
    if (ready(session.id)) {
      clearInterval(t);
      asking = false;
      (session.running ? queueNext : prompt)(text, () => {});
      remember(profile, mac, session.id, session.sessionId ?? (open ? open.sessionId : reuse?.sessionId) ?? null);
    } else if (Date.now() - started > 15000) {
      clearInterval(t);
      asking = false;
      notice('The Codex chat did not open. The question was not sent.');
    }
  }, 150);
  window.dispatchEvent(new CustomEvent('agentview:command', { detail: { id: 'tab:chat' } }));
  return true;
}

// A new chat gets its Claude session id after the first prompt; keep it so a closed chat can be reopened.
function remember(profile: Profile, mac: string, chat: string, sessionId: string | null) {
  saveDaily(profile, { day: today(), mac, chat, sessionId });
  if (sessionId) return;
  const started = Date.now();
  const t = setInterval(() => {
    const c = getState().live.find((x) => x.id === chat);
    if (c?.sessionId) saveDaily(profile, { day: today(), mac, chat, sessionId: c.sessionId });
    if (c?.sessionId || Date.now() - started > 60000) clearInterval(t);
  }, 1000);
}

export function wikiAskText(question: string, pages: Page[], facts: Fact[], pageId?: string) {
  const title = new Map(pages.map((p) => [p.id, p.title ?? '']));
  const current = currentClaim(facts);
  const claims = live(facts)
    .filter((f) => current(f) && !isOld(f) && (!pageId || f.page_id === pageId))
    .sort((a, b) => factTime(b) - factTime(a))
    .slice(0, 200)
    .map((f) => `- [${title.get(f.page_id ?? '') || 'Memory'}]${f.at ? ` ${new Date(f.at).toISOString().slice(0, 10)}:` : ''} ${f.text}${sourcesOf(f).length ? ` (${sourcesOf(f).map((s) => s.label).join(', ')})` : ''}${f.contested ? ' (contested)' : ''}`);
  return [
    question,
    `\n${pageId ? `Claims on the wiki page "${title.get(pageId)}"` : 'Claims in my team wiki'}:\n${claims.join('\n')}`,
    '\nAnswer from these claims first and name the claims you used; use my Slack, Linear and Calendar connectors when they are not enough.',
  ].join('\n');
}

export function meetingAskText(question: string, m: Meeting, actions: ItemRow[]) {
  const when = m.starts_at ? new Date(m.starts_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';
  return [
    question,
    `\nAbout the meeting "${m.title}" (${when}) with ${(m.people?.startsWith('[') ? listOf(m.people) : [m.people]).filter(Boolean).join(', ') || 'no listed people'}.`,
    m.notes && `\nMy notes:\n${m.notes}`,
    m.summary && `\nSummary:\n${m.summary}`,
    listOf(m.decisions).length ? `\nDecisions:\n${listOf(m.decisions).map((d) => `- ${d}`).join('\n')}` : '',
    actions.length ? `\nActions from it (open and done are mine, suggested probably mine, unassigned nobody took, dismissed not mine):\n${actions.map((a) => `- [${a.status}] ${a.title}`).join('\n')}` : '',
    othersOf(m).length ? `\nWhat others took on:\n${othersOf(m).map((o) => `- ${o.who}: ${o.what}`).join('\n')}` : '',
    '\nUse my Calendar, Slack and Linear connectors when the question needs them.',
  ].filter(Boolean).join('\n');
}
