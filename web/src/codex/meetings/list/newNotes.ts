import { newId } from '../../data/sync';
import { type Meeting } from '../../data/wiki/wiki';

export function newNotes(profile: 'personal' | 'work'): Meeting {
  const t = Date.now();
  return {
    id: newId(), profile, version: 0, updated_at: t, deleted: 0, dirty: 1, field_times: '{}',
    title: 'Notes', starts_at: t, ends_at: null, people: null, calendar_url: null, recorded_ms: null, notes: '', summary: null, decisions: null, transcript: null, tries: null, room: null, room_me: null, organizer_me: null, others: null, links: null,
  };
}
