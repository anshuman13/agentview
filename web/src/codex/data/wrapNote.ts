import { dayStart, ymd } from './dates';
import type { Brief } from './wiki';
import type { Profile } from './sync';

const MAX = 200;

export const wrapNoteId = (now: number) => `wrapup:${ymd(now)}`;
export const wrapNoteProfile = (filter: Profile | 'all'): Profile => (filter === 'all' ? 'work' : filter);
export const normaliseNote = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, MAX).trim();

export type NoteWrite = { row: Brief; patch: Partial<Brief> };

// The row and patch to save the typed note, or null when nothing changes.
export function planNoteWrite(existing: Brief | undefined, input: string, profile: Profile, now: number): NoteWrite | null {
  const text = normaliseNote(input);
  const live = existing && !existing.deleted;
  if (!text) return live ? { row: existing, patch: { deleted: 1 } } : null;
  if (live && existing.text === text) return null;
  if (existing) return { row: existing, patch: { text, to_at: now, deleted: 0 } };
  const from_at = dayStart(now);
  const row: Brief = { id: wrapNoteId(now), profile, version: 0, updated_at: now, deleted: 0, field_times: '{}', dirty: 1, kind: 'wrapup', text: null, from_at, to_at: null };
  return { row, patch: { kind: 'wrapup', text, from_at, to_at: now } };
}
