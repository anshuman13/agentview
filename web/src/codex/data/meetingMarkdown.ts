import { ymd } from './dates';
import { atTime } from './engine';
import type { ItemRow } from './sync';
import { listOf, othersOf, type Decision, type Meeting } from './wiki';
import { peopleOf, type Question } from './meetings';

const mine = (actions: ItemRow[]) => actions.filter((a) => a.status === 'open' || a.status === 'done');
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

export function decisionsMarkdown(rows: Decision[]) {
  const groups = new Map<Meeting, string[]>();
  for (const d of rows) groups.set(d.meeting, [...(groups.get(d.meeting) ?? []), d.text]);
  return [...groups].map(([m, texts]) => `## ${m.title ?? 'Meeting'}${dateOf(m) ? `, ${dateOf(m)}` : ''}\n\n${texts.map((t) => `- ${t}`).join('\n')}`).join('\n\n') + '\n';
}

type PersonParts = {
  commitments: { what: string; meeting: Meeting }[];
  questions: Question[];
  points: ItemRow[];
  pins: ItemRow[];
  meetings: Meeting[];
  claims: { text?: string | null }[];
};

export function personMarkdown(name: string, parts: PersonParts) {
  const sections: [string, string[]][] = [
    ['Commitments', parts.commitments.map((c) => `${c.what} (${c.meeting.title ?? 'Meeting'})`)],
    ['Open questions', parts.questions.map((q) => q.text)],
    ['To raise', parts.points.map((p) => p.title ?? '')],
    ['Pinned', parts.pins.map((p) => p.text?.trim() || p.title || '')],
    ['Meetings', parts.meetings.map((m) => `${m.title ?? 'Meeting'}${dateOf(m) ? ` (${dateOf(m)})` : ''}`)],
    ['In the wiki', parts.claims.map((c) => c.text ?? '')],
  ];
  const out = [`# ${name}`];
  for (const [head, lines] of sections) if (lines.length) out.push(`## ${head}\n\n${lines.map((l) => `- ${l}`).join('\n')}`);
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

type AgendaParts = { points: ItemRow[]; actions: string[]; questions: string[] };

export function agendaMarkdown(m: Meeting, parts: AgendaParts) {
  const sections: [string, string[]][] = [
    ['To raise', parts.points.map((p) => `${first(p.people ?? '')}: ${p.title ?? ''}`)],
    ['Open actions', parts.actions],
    ['Open questions', parts.questions],
  ];
  const out = [`# Agenda: ${m.title ?? 'Meeting'}${dateOf(m) ? ` (${dateOf(m)})` : ''}`];
  if (peopleOf(m).length) out.push(`Attendees: ${peopleOf(m).join(', ')}`);
  for (const [head, lines] of sections) if (lines.length) out.push(`## ${head}\n\n${lines.map((l) => `- [ ] ${l}`).join('\n')}`);
  return out.join('\n\n') + '\n';
}
