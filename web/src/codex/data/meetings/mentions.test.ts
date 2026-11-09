import { describe, expect, it } from 'vitest';
import { mentionsOf } from './mentions';
import type { ItemRow } from '../sync';
import type { Meeting } from '../wiki/wiki';

const task = (id: string, extra: Partial<ItemRow>) => ({ id, profile: 'work', status: 'open', deleted: 0, at: null, rank: null, title: '', text: null, ...extra }) as unknown as ItemRow;
const meeting = (id: string, extra: Partial<Meeting>) => ({ id, profile: 'work', deleted: 0, title: '', notes: null, summary: null, decisions: null, starts_at: 1, ...extra }) as unknown as Meeting;
const claim = { text: 'Invoices export monthly', profile: 'work' };
const ids = (m: ReturnType<typeof mentionsOf>) => [...m.shown, ...m.rest].map((x) => x.id);
const find = (items: ItemRow[], meetings: Meeting[] = [], title = 'Billing') => mentionsOf({ items, meetings }, claim, title);

describe('mentionsOf', () => {
  it('matches the whole title phrase, ignoring case, and needs a shared claim word', () => {
    const items = [task('a', { title: 'Fix BILLING invoices export' }), task('b', { title: 'Fix billings invoices' }), task('c', { title: 'Fix billing layout' }), task('d', { title: 'Email re-billing invoices' })];
    expect(ids(find(items))).toEqual(['a', 'd']);
  });

  it('skips other profiles, deleted, done and not-live rows', () => {
    const items = [task('a', { title: 'Billing invoices' }), task('b', { title: 'Billing invoices', profile: 'personal' }), task('c', { title: 'Billing invoices', deleted: 1 }), task('d', { title: 'Billing invoices', status: 'done' })];
    const meetings = [meeting('m', { title: 'Billing invoices', deleted: 1 })];
    expect(ids(find(items, meetings))).toEqual(['a']);
  });

  it('ignores titles under 3 characters and reads regex characters literally', () => {
    expect(ids(find([task('a', { title: 'AI invoices' })], [], 'AI'))).toEqual([]);
    const items = [task('a', { title: 'C++ invoices' }), task('b', { title: 'Cxx invoices' })];
    expect(ids(find(items, [], 'C++'))).toEqual(['a']);
    expect(ids(find(items, [], '.*'))).toEqual([]);
  });

  it('lists tasks by due time, then meetings newest first, and splits after 3', () => {
    const items = [task('a', { title: 'Billing invoices' }), task('b', { title: 'Billing invoices', at: '2026-11-07T10:00:00Z' })];
    const meetings = [meeting('m1', { title: 'Billing invoices', starts_at: 1 }), meeting('m2', { notes: 'Billing invoices', starts_at: 2 }), meeting('m3', { summary: 'Billing invoices', starts_at: 3 })];
    const out = find(items, meetings);
    expect(out.shown.map((x) => x.id)).toEqual(['b', 'a', 'm3']);
    expect(out.rest.map((x) => x.id)).toEqual(['m2', 'm1']);
  });
});
