import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeetingPage } from './MeetingPage';

vi.mock('../data', () => ({
  useAssistantStore: () => ({ editRow: vi.fn(), capture: vi.fn() }),
  useAssistantData: () => ({ items: [] }),
  useCodex: () => ({ meetings: [] }),
}));
vi.mock('./Prep', () => ({ Prep: () => <div>Prep</div> }));
vi.mock('../wiki/Wiki', () => ({ AskBar: () => <div>AskBar</div> }));
vi.mock('./Transcript', () => ({
  RoomMic: () => <div>RoomMic</div>,
  SummaryFormat: () => null,
  TalkTime: () => null,
  Transcript: () => <div>Transcript</div>,
  TranscriptButton: () => null,
  readable: () => false,
  useRead: () => ({ busy: false, read: vi.fn() }),
  useTranscript: () => null,
}));

const start = new Date('2026-11-03T10:00:00').getTime();
const past = { id: 'm1', profile: 'work', title: 'Weekly sync', starts_at: start, ends_at: start + 1800000, room: 'Big room', room_me: 1, people: 'Ada Lovelace, Bob Ray, Cy Young', summary: 'We agreed.', transcript: 'done' };

describe('MeetingPage', () => {
  it('shows only the read-most blocks for a plain past meeting while More is collapsed', () => {
    const h = renderToStaticMarkup(<MeetingPage m={past as never} />);
    for (const t of ['Weekly sync', 'My actions', 'Summary', 'My notes']) expect(h).toContain(t);
    expect(h).toMatch(/class="mt-meta">[^<]*Big room · 3 people</);
    for (const t of ['mt-state', 'RoomMic', 'Add an action', 'Unassigned', 'Others took', 'Not mine', 'Transcript', 'AskBar', 'mt-chips']) expect(h).not.toContain(t);
    expect(h).toMatch(/<button[^>]*class="ui-section-head"[^>]*aria-expanded="false"[^>]*>.*?More/);
  });
});
