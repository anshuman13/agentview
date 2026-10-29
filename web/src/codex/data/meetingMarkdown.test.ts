import { describe, expect, it } from 'vitest';
import { draftFor, followUpText, toMarkdown } from './meetingMarkdown';
import type { ItemRow } from './sync';
import type { Meeting } from './wiki';

const meeting = (over: Partial<Meeting> = {}) =>
  ({ id: 'm1', profile: 'work', title: 'Planning', starts_at: Date.UTC(2026, 9, 29, 10), people: JSON.stringify(['Ada Lovelace', 'Grace Hopper']), summary: 'We planned the quarter.', decisions: JSON.stringify(['Ship in November']), others: JSON.stringify([{ who: 'Grace Hopper', what: 'draft the spec' }]), ...over }) as unknown as Meeting;
const action = (title: string, status: string) => ({ id: title, title, status }) as unknown as ItemRow;

describe('toMarkdown', () => {
  it('writes the title, attendees and every section', () => {
    const md = toMarkdown(meeting(), [action('Send notes', 'open')]);
    expect(md).toContain('# Planning (2026-10-29)');
    expect(md).toContain('Attendees: Ada Lovelace, Grace Hopper');
    expect(md).toContain('## Summary');
    expect(md).toContain('## Decisions\n\n- Ship in November');
    expect(md).toContain('## Actions');
  });

  it('marks done actions checked and open ones unchecked', () => {
    const md = toMarkdown(meeting(), [action('Send notes', 'open'), action('Book room', 'done')]);
    expect(md).toContain('- [ ] Send notes');
    expect(md).toContain('- [x] Book room');
  });

});

describe('followUpText', () => {
  it('greets attendees by first name and lists decisions and owners', () => {
    const t = followUpText(meeting(), [action('send notes', 'open')]);
    expect(t).toContain('Hi Ada, Grace,');
    expect(t).toContain('Thanks');
    expect(t).toContain('- Ship in November');
    expect(t).toContain('- Grace: draft the spec');
    expect(t).toContain('- I will send notes');
  });
});

describe('draftFor', () => {
  it('names the action, owner, meeting and due date', () => {
    const a = { id: 'a', title: 'Send notes', status: 'open', people: 'Ada Lovelace', at: Date.UTC(2026, 10, 2, 9) } as unknown as ItemRow;
    expect(draftFor(a, meeting())).toBe('Send notes\nOwner: Ada Lovelace\nFrom: Planning (2026-10-29)\nDue: 2026-11-02');
  });
});
