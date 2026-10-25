import { getState, notice, prompt, send } from '../store';
import { atTime } from './engine';
import type { ItemRow } from './sync';
import { listOf, sourcesOf, type Action, type Fact, type Meeting, type Page } from './wiki';

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

// Opens a new chat on the current Mac and sends the question there once the chat is shown.
export function ask(text: string) {
  if (!getState().ui.connected) {
    notice('Not connected to a Mac, the question was not sent');
    return false;
  }
  const from = getState().session.id;
  send({ type: 'new_session' });
  const started = Date.now();
  const t = setInterval(() => {
    const id = getState().session.id;
    if (id && id !== from) {
      clearInterval(t);
      prompt(text, () => {});
    } else if (Date.now() - started > 15000) {
      clearInterval(t);
      notice('The new chat did not open, the question was not sent');
    }
  }, 150);
  window.dispatchEvent(new CustomEvent('agentview:command', { detail: { id: 'tab:chat' } }));
  return true;
}

export function wikiAskText(question: string, pages: Page[], facts: Fact[], pageId?: string) {
  const title = new Map(pages.map((p) => [p.id, p.title ?? '']));
  const claims = facts
    .filter((f) => !f.deleted && !f.superseded_by && (!pageId || f.page_id === pageId))
    .slice(0, 200)
    .map((f) => `- [${title.get(f.page_id ?? '') ?? ''}] ${f.text}${sourcesOf(f).length ? ` (${sourcesOf(f).map((s) => s.label).join(', ')})` : ''}${f.contested ? ' (contested)' : ''}`);
  return [
    question,
    `\n${pageId ? `Claims on the wiki page "${title.get(pageId)}"` : 'Claims in my team wiki'}:\n${claims.join('\n')}`,
    '\nAnswer from these claims first and name the claims you used; use my Slack, Linear and Calendar connectors when they are not enough.',
  ].join('\n');
}

export function meetingAskText(question: string, m: Meeting, actions: Action[]) {
  const when = m.starts_at ? new Date(m.starts_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return [
    question,
    `\nAbout the meeting "${m.title}" (${when}) with ${m.people || 'no listed people'}.`,
    m.notes && `\nMy notes:\n${m.notes}`,
    m.summary && `\nSummary:\n${m.summary}`,
    listOf(m.decisions).length ? `\nDecisions:\n${listOf(m.decisions).map((d) => `- ${d}`).join('\n')}` : '',
    actions.length ? `\nProposed actions:\n${actions.map((a) => `- [${a.status}] ${a.kind} ${a.target}: ${a.title}`).join('\n')}` : '',
    '\nUse my Calendar, Slack and Linear connectors when the question needs them.',
  ].filter(Boolean).join('\n');
}
