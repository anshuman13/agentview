import { describe, expect, it, vi } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Meeting } from '../data/wiki/wiki';
import * as data from '../data';
import * as view from '../view';
import { stubGlobal } from '../../../../testing';

vi.mock('../data', () => ({
  ...data,
  useAssistantStore: () => ({}),
  useAssistantData: () => ({ items: [], facts: [], meetings: [] }),
  useCodex: () => ({ meetings: [] }),
}));
const snacks: { text: string; undo?: () => void }[] = [];
vi.mock('../view', () => ({ ...view, showSnack: (text: string, undo?: () => void) => snacks.push({ text, undo }) }));

stubGlobal('window', {});

const { MeetingPage } = await import('./MeetingPage');
const { dismissTranscript } = await import('./MeetingPageParts');

const start = Date.UTC(2026, 9, 29, 8);
const meeting = (extra: Partial<Meeting>) =>
  ({ id: 'cal:a', profile: 'work', deleted: 0, title: 'Check out and buy lunch', starts_at: start, ends_at: start + 3_600_000, people: '[]', notes: '', ...extra }) as Meeting;
const render = (m: Meeting) => renderToStaticMarkup(<MeetingPage m={m} />);

describe('MeetingPage', () => {
  it('shows an event without the meeting sections', () => {
    const html = render(meeting({}));
    expect(html).toContain('>Event<');
    expect(html).toContain('My notes');
    expect(html).toContain('My actions');
    expect(html).not.toContain('Summary');
    expect(html).not.toContain('written after');
    expect(html).not.toContain('>More<');
    expect(html).toContain('aria-label="More"');
  });

  it('keeps Summary for a meeting with people', () => {
    const html = render(meeting({ people: '["Sam"]' }));
    expect(html).toContain('>Meetings<');
    expect(html).toContain('Summary');
  });

  it('dismisses a missing transcript and Undo brings the line back', () => {
    let m = meeting({ people: '["Sam"]', transcript: 'missing' });
    const store = { editRow: async (_table: string, _row: Meeting, patch: Partial<Meeting>) => { m = { ...m, ...patch }; } };
    expect(render(m)).toContain('No transcript for this meeting');
    dismissTranscript(store as never, m);
    expect(render(m)).not.toContain('No transcript for this meeting');
    expect(snacks.at(-1)?.text).toBe('Transcript dismissed');
    snacks.at(-1)?.undo?.();
    expect(render(m)).toContain('No transcript for this meeting');
  });
});
