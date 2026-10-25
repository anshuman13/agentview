import { getState, notice, prompt, send } from '../store';
import { atTime } from './engine';
import type { ItemRow } from './sync';

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
    open.length ? `\nMy open items in the Assistant:\n${open.map(line).join('\n')}` : '',
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
