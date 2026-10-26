import { getState, notice, prompt, queueNext, send } from '../../app/store';
import { macOrigin } from '../../app/api';
import { atTime } from './engine';
import type { ItemRow } from './sync';
import { factTime, listOf, live, sourcesOf, type Fact, type Meeting, type Page } from './wiki';

const line = (r: ItemRow) => {
  const at = atTime(r.at);
  const bits = [r.source && r.source !== 'capture' && r.source, at && `due ${new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`, r.source_url].filter(Boolean);
  return `- [${r.profile}] ${r.title ?? '(untitled)'}${bits.length ? ` (${bits.join(', ')})` : ''}`;
};

export function askText(question: string, items: ItemRow[], about?: ItemRow) {
  const open = items.filter((r) => !r.deleted && r.status === 'open').slice(0, 60);
  return [
    question,
    about && `\nAbout this item:\n${line(about)}${about.text ? `\n${about.text}` : ''}`,
    open.length ? `\nMy open items in Codex:\n${open.map(line).join('\n')}` : '',
    '\nUse my Slack, Calendar, Gmail and Linear connectors when the question needs them.',
  ].filter(Boolean).join('\n');
}

type Daily = { day: string; mac: string; chat: string; sessionId: string | null };
const KEY = 'codex-chat';
const today = () => new Date().toDateString();
const readDaily = (): Daily | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const saveDaily = (d: Daily) => localStorage.setItem(KEY, JSON.stringify(d));
let asking = false;

// Sends the question to today's Codex chat on the current Mac. The first question of the day, or fresh, opens a new chat.
export function ask(text: string, fresh = false) {
  const s = getState();
  if (!s.ui.connected) {
    notice('Not connected to a Mac, the question was not sent');
    return false;
  }
  if (asking) return false;
  asking = true;
  const mac = macOrigin();
  const d = readDaily();
  const reuse = !fresh && d?.day === today() && d.mac === mac ? d : null;
  const open = reuse && s.live.find((c) => c.id === reuse.chat || (reuse.sessionId != null && c.sessionId === reuse.sessionId));
  const from = s.session.id;
  let ready: (id: string) => boolean;
  if (open) {
    if (from !== open.id) send({ type: 'view', id: open.id });
    ready = (id) => id === open.id;
  } else {
    send(reuse?.sessionId ? { type: 'open_session', sessionId: reuse.sessionId } : { type: 'new_session' });
    ready = (id) => !!id && id !== from;
  }
  const started = Date.now();
  const t = setInterval(() => {
    const { session } = getState();
    if (ready(session.id)) {
      clearInterval(t);
      asking = false;
      (session.running ? queueNext : prompt)(text, () => {});
      remember(mac, session.id, session.sessionId ?? (open ? open.sessionId : reuse?.sessionId) ?? null);
    } else if (Date.now() - started > 15000) {
      clearInterval(t);
      asking = false;
      notice('The Codex chat did not open, the question was not sent');
    }
  }, 150);
  window.dispatchEvent(new CustomEvent('agentview:command', { detail: { id: 'tab:chat' } }));
  return true;
}

// A new chat gets its Claude session id after the first prompt; keep it so a closed chat can be reopened.
function remember(mac: string, chat: string, sessionId: string | null) {
  saveDaily({ day: today(), mac, chat, sessionId });
  if (sessionId) return;
  const started = Date.now();
  const t = setInterval(() => {
    const c = getState().live.find((x) => x.id === chat);
    if (c?.sessionId) saveDaily({ day: today(), mac, chat, sessionId: c.sessionId });
    if (c?.sessionId || Date.now() - started > 60000) clearInterval(t);
  }, 1000);
}

export function wikiAskText(question: string, pages: Page[], facts: Fact[], pageId?: string) {
  const title = new Map(pages.map((p) => [p.id, p.title ?? '']));
  const claims = live(facts)
    .filter((f) => !f.superseded_by && (!pageId || f.page_id === pageId))
    .sort((a, b) => factTime(b) - factTime(a))
    .slice(0, 200)
    .map((f) => `- [${title.get(f.page_id ?? '') || 'Memory'}] ${f.text}${sourcesOf(f).length ? ` (${sourcesOf(f).map((s) => s.label).join(', ')})` : ''}${f.contested ? ' (contested)' : ''}`);
  return [
    question,
    `\n${pageId ? `Claims on the wiki page "${title.get(pageId)}"` : 'Claims in my team wiki'}:\n${claims.join('\n')}`,
    '\nAnswer from these claims first and name the claims you used; use my Slack, Linear and Calendar connectors when they are not enough.',
  ].join('\n');
}

export function meetingAskText(question: string, m: Meeting, actions: ItemRow[]) {
  const when = m.starts_at ? new Date(m.starts_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return [
    question,
    `\nAbout the meeting "${m.title}" (${when}) with ${(m.people?.startsWith('[') ? listOf(m.people) : [m.people]).filter(Boolean).join(', ') || 'no listed people'}.`,
    m.notes && `\nMy notes:\n${m.notes}`,
    m.summary && `\nSummary:\n${m.summary}`,
    listOf(m.decisions).length ? `\nDecisions:\n${listOf(m.decisions).map((d) => `- ${d}`).join('\n')}` : '',
    actions.length ? `\nMy actions from it:\n${actions.map((a) => `- [${a.status}] ${a.title}`).join('\n')}` : '',
    '\nUse my Calendar, Slack and Linear connectors when the question needs them.',
  ].filter(Boolean).join('\n');
}
