import { describe, expect, it } from 'vitest';
import { agendaMarkdown, decisionsMarkdown, followUpText, hasContent, personMarkdown, toMarkdown } from './meetingMarkdown';
import type { ItemRow } from './sync';
import type { Decision, Meeting } from './wiki';
import type { Question } from './meetings';

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

  it('omits empty sections', () => {
    expect(toMarkdown(meeting({ decisions: null }), [])).not.toContain('## Decisions');
  });

  it('lists only open actions as unchecked boxes', () => {
    const md = toMarkdown(meeting(), [action('Send notes', 'open'), action('Book room', 'done'), action('Old idea', 'dismissed'), action('Maybe call', 'suggested')]);
    expect(md).toContain('- [ ] Send notes');
    for (const gone of ['Book room', 'Old idea', 'Maybe call', '[x]']) expect(md).not.toContain(gone);
  });

  it('drops an action once it is done', () => {
    const a = action('Send notes', 'open');
    expect(toMarkdown(meeting(), [a])).toContain('Send notes');
    a.status = 'done';
    expect(toMarkdown(meeting(), [a])).not.toContain('Send notes');
  });
});

describe('hasContent', () => {
  it('needs a summary, a decision or an open action', () => {
    const bare = meeting({ summary: null, decisions: null });
    expect(hasContent(bare, [action('Book room', 'done')])).toBe(false);
    expect(hasContent(bare, [action('Send notes', 'open')])).toBe(true);
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

describe('decisionsMarkdown', () => {
  it('groups decisions under their meeting and date', () => {
    const other = meeting({ id: 'm2', title: 'Retro', starts_at: Date.UTC(2026, 9, 20, 10) });
    const m = meeting();
    const rows = [{ meeting: m, text: 'Ship in November' }, { meeting: m, text: 'Hire one more' }, { meeting: other, text: 'Skip the demo' }] as Decision[];
    expect(decisionsMarkdown(rows)).toBe('## Planning, 2026-10-29\n\n- Ship in November\n- Hire one more\n\n## Retro, 2026-10-20\n\n- Skip the demo\n');
  });
});

describe('personMarkdown', () => {
  it('writes only the sections that have rows, in page order', () => {
    const m = meeting();
    const md = personMarkdown('Ada Lovelace', {
      commitments: [{ what: 'draft the spec', meeting: m }],
      questions: [{ text: 'Who owns billing?' } as Question],
      points: [action('Ask about the offsite', 'point')],
      pins: [],
      meetings: [m],
      claims: [],
    });
    expect(md).toBe('# Ada Lovelace\n\n## Commitments\n\n- draft the spec (Planning)\n\n## Open questions\n\n- Who owns billing?\n\n## To raise\n\n- Ask about the offsite\n\n## Meetings\n\n- Planning (2026-10-29)\n');
  });
});

describe('agendaMarkdown', () => {
  it('lists points by first name, then actions and questions, skipping empty sections', () => {
    const point = { id: 'p', title: 'Budget for Q1', people: 'Grace Hopper', status: 'point' } as unknown as ItemRow;
    const md = agendaMarkdown(meeting(), { points: [point], actions: ['Grace: draft the spec'], questions: [] });
    expect(md).toBe('# Agenda: Planning (2026-10-29)\n\nAttendees: Ada Lovelace, Grace Hopper\n\n## To raise\n\n- [ ] Grace: Budget for Q1\n\n## Open actions\n\n- [ ] Grace: draft the spec\n');
  });
});
