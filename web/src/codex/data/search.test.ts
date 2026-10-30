import { describe, expect, it } from 'vitest';
import { GROUP_CAP, related, searchAll, snippet } from './search';
import type { ItemRow } from './sync';
import type { Fact, Job, Meeting, Page } from './wiki';

const common = (id: string) => ({ id, profile: 'work' as const, version: 0, updated_at: 0, deleted: 0, field_times: '{}', dirty: 0 });
const item = (id: string, title: string, extra: Partial<ItemRow> = {}): ItemRow => ({
  ...common(id), title, text: null, source: null, source_url: null, people: null, at: null, status: 'open', meeting_id: null, rolls: null, rolled_from: null, rank: null, ...extra,
});
const meeting = (id: string, title: string, extra: Partial<Meeting> = {}): Meeting => ({
  ...common(id), title, starts_at: 1, ends_at: 2, people: null, calendar_url: null, recorded_ms: null, notes: null, summary: null, decisions: null, transcript: null, tries: null, room: null, room_me: null, others: null, ...extra,
});
const page = (id: string, title: string): Page => ({ ...common(id), title, section: 'Pages', summary: null, sort: 0, state: null });
const fact = (id: string, pageId: string | null, text: string, extra: Partial<Fact> = {}): Fact => ({
  ...common(id), text, item_id: null, superseded_by: null, page_id: pageId, heading: 'One', sources: null, at: 0, contested: null, state: null, replaces: null, added_by: null, ...extra,
});
const job = (id: string, name: string, prompt: string): Job => ({ ...common(id), name, schedule: 'hourly', prompt, enabled: 1, next_run_at: null });

const data = {
  items: [item('i1', 'Send budget'), item('i2', 'Budget gone', { status: 'dismissed' }), item('i4', 'Budget point', { status: 'point' }), item('i3', 'Other')],
  meetings: [meeting('m1', 'Planning', { summary: 'We agreed the budget is fixed' })],
  facts: [fact('f1', 'p1', 'Budget owner is Sam'), fact('f2', 'p1', 'Budget old', { superseded_by: 'f1' })],
  pages: [page('p1', 'Budget page')],
  jobs: [job('j1', 'Digest', 'Summarise the budget')],
};

describe('search', () => {
  it('groups hits and skips dismissed, points, superseded and empty queries', () => {
    const r = searchAll(data, 'budget');
    expect(r.tasks.hits.map((h) => h.id)).toEqual(['i1']);
    expect(r.meetings.hits.map((h) => h.id)).toEqual(['m1']);
    expect(r.wiki.hits.map((h) => h.id)).toEqual(['p1', 'f1']);
    expect(r.jobs.hits.map((h) => h.id)).toEqual(['j1']);
    expect(r.total).toBe(5);
    expect(searchAll(data, '  ').total).toBe(0);
  });

  it('caps a group and reports its total', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`n${i}`, 'Budget note'));
    const r = searchAll({ ...data, items }, 'budget');
    expect(r.tasks.hits).toHaveLength(GROUP_CAP);
    expect(r.tasks.total).toBe(12);
  });

  it('returns every hit for an expanded group', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`n${i}`, 'Budget note'));
    expect(searchAll({ ...data, items }, 'budget', ['tasks']).tasks.hits).toHaveLength(12);
  });

  it('cuts a snippet around the first match', () => {
    const text = `${'a '.repeat(60)}needle ${'b '.repeat(60)}`;
    const s = snippet(['needle'], text);
    expect(s.startsWith('...')).toBe(true);
    expect(s.endsWith('...')).toBe(true);
    expect(s).toContain('needle');
    expect(snippet(['x'], null, 'no match')).toBe('');
  });

  it('ranks related claims, meetings and Slack chats by shared key words', () => {
    const rel = {
      pages: [page('p1', 'Gateway')],
      facts: [fact('f1', 'p1', 'Rate limit is 60 requests', { at: Date.now() }), fact('f2', 'p1', 'Lunch is at noon', { at: Date.now() })],
      meetings: [meeting('m1', 'Gateway rate review', { starts_at: 5 }), meeting('m2', 'Rate chat', { notes: 'gateway limit requests' }), meeting('m3', 'Gateway rate', { starts_at: Date.now() + 1e9 })],
      items: [item('s1', 'Gateway rate limit question', { source: 'slack', source_url: 'https://chat.example/s1' }), item('s2', 'Gateway rate', { source: 'slack', profile: 'personal' })],
    };
    const got = related(rel, 'raise the gateway rate limit for requests', 'work');
    expect(got.map((h) => `${h.kind}:${h.id}`)).toEqual(['wiki:f1', 'meeting:m2', 'slack:s1']);
    expect(related(rel, 'gateway rate limit requests', 'work', ['f1', 'm2']).map((h) => h.id)).toEqual(['s1', 'm1']);
    expect(related(rel, 'gateway', 'work')).toEqual([]);
  });
});
