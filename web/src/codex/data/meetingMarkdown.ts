import { atTime } from './engine';
import type { ItemRow } from './sync';
import { listOf, othersOf, peopleOf, type Meeting } from './wiki';

const mine = (actions: ItemRow[]) => actions.filter((a) => a.status === 'open' || a.status === 'done');
const ymd = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dateOf = (m: Meeting) => (m.starts_at ? ymd(m.starts_at) : '');
const first = (name: string) => name.split(/\s+/)[0] ?? name;

export const hasContent = (m: Meeting, actions: ItemRow[]) =>
  Boolean(m.summary?.trim()) || listOf(m.decisions).length > 0 || mine(actions).length > 0;

export function toMarkdown(m: Meeting, actions: ItemRow[]) {
  const date = dateOf(m);
  const people = peopleOf(m);
  const decisions = listOf(m.decisions);
  const todo = mine(actions);
  const out = [`# ${m.title ?? 'Meeting'}${date ? ` (${date})` : ''}`];
  if (people.length) out.push(`Attendees: ${people.join(', ')}`);
  if (m.summary?.trim()) out.push(`## Summary\n\n${m.summary.trim()}`);
  if (decisions.length) out.push(`## Decisions\n\n${decisions.map((d) => `- ${d}`).join('\n')}`);
  if (todo.length) out.push(`## Actions\n\n${todo.map((a) => `- [${a.status === 'done' ? 'x' : ' '}] ${a.title ?? ''}`).join('\n')}`);
  return out.join('\n\n') + '\n';
}

export function followUpText(m: Meeting, actions: ItemRow[]) {
  const people = peopleOf(m).map(first);
  const decisions = listOf(m.decisions);
  const who = [
    ...othersOf(m).map((o) => `- ${first(o.who)}: ${o.what}`),
    ...mine(actions).filter((a) => a.status === 'open').map((a) => `- I will ${a.title ?? ''}`),
  ];
  const out = [`Hi ${people.length ? people.join(', ') : 'all'},`, `Thanks for the time on ${m.title ?? 'our meeting'}.`];
  if (decisions.length) out.push(`What we decided:\n${decisions.map((d) => `- ${d}`).join('\n')}`);
  if (who.length) out.push(`Who does what:\n${who.join('\n')}`);
  out.push('Let me know if I missed anything.', 'Best,');
  return out.join('\n\n') + '\n';
}

export function draftFor(a: ItemRow, m: Meeting) {
  const due = atTime(a.at);
  const out = [a.title ?? ''];
  if (a.people?.trim()) out.push(`Owner: ${a.people.trim()}`);
  out.push(`From: ${m.title ?? 'Meeting'}${dateOf(m) ? ` (${dateOf(m)})` : ''}`);
  if (due != null) out.push(`Due: ${ymd(due)}`);
  return out.join('\n');
}
