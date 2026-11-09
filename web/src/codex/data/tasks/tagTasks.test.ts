import { describe, expect, it } from 'vitest';
import { tagTasks } from './tagTasks';
import type { ItemRow } from '../sync';

const row = (id: string, extra: Partial<ItemRow>) => ({ id, profile: 'work', status: 'open', deleted: 0, at: null, rank: null, tags: 'faq', ...extra }) as unknown as ItemRow;
const ids = (rs: ItemRow[]) => rs.map((r) => r.id);

describe('tagTasks', () => {
  it('matches the whole tag, ignoring case, in both profiles', () => {
    const items = [row('a', { tags: 'FAQ' }), row('b', { profile: 'personal', tags: 'x faq' }), row('c', { tags: 'faq2' }), row('d', { tags: 'needs-faq' })];
    expect(ids(tagTasks(items, 'faq'))).toEqual(['a', 'b']);
    expect(ids(tagTasks(items, 'Faq'))).toEqual(['a', 'b']);
  });

  it('skips done, deleted, null and empty tags', () => {
    const items = [row('a', { status: 'done' }), row('b', { deleted: 1 }), row('c', { tags: null }), row('d', { tags: '' }), row('e', {})];
    expect(ids(tagTasks(items, 'faq'))).toEqual(['e']);
  });

  it('orders by due time with undated last, then rank', () => {
    const items = [row('a', { rank: 1 }), row('b', { at: '2026-11-08T10:00:00Z' }), row('c', { at: '2026-11-07T10:00:00Z' }), row('d', { rank: 2 }), row('e', { at: '2026-11-07T10:00:00Z', rank: 1 })];
    expect(ids(tagTasks(items, 'faq'))).toEqual(['e', 'c', 'b', 'a', 'd']);
  });
});
