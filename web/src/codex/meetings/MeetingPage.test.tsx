import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Meeting } from '../data/wiki/wiki';
import * as data from '../data';
import { stubGlobal } from '../../../../testing';

vi.mock('../data', async (importOriginal) => ({
  ...(importOriginal ? await importOriginal<object>() : data),
  useAssistantStore: () => ({}),
  useAssistantData: () => ({ items: [], facts: [], meetings: [] }),
  useCodex: () => ({ meetings: [] }),
}));

stubGlobal('window', {});

const { MeetingPage } = await import('./MeetingPage');

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
    expect(html).not.toContain('More');
  });

  it('keeps Summary for a meeting with people', () => {
    const html = render(meeting({ people: '["Sam"]' }));
    expect(html).toContain('>Meetings<');
    expect(html).toContain('Summary');
  });
});
