import { expect, it } from 'bun:test';
import { morningLines, parseMorningRows } from './morning';

it('turns brief rows into one line per topic, first item and how many more', () => {
  const rows = parseMorningRows(JSON.stringify([
    { section: 'tasks', title: 'Send invoice', meta: 'overdue' },
    { section: 'meetings', title: 'Standup', meta: '09:00-09:30' },
    { section: 'meetings', title: 'Review', meta: '13:00-14:00' },
    { section: 'plan', title: 'Free 7h30', meta: '' },
    { section: 'plan', title: '1 task at risk', meta: '' },
  ]));
  expect(morningLines(rows)).toEqual([
    { label: 'Meetings', text: 'Standup (09:00-09:30) and 1 more' },
    { label: 'Time', text: 'Free 7h30, 1 task at risk' },
    { label: 'Tasks', text: 'Send invoice (overdue)' },
  ]);
  expect(parseMorningRows('nope')).toEqual([]);
});
