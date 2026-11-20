import { isOld } from './claimAge.js';

export const PREFERENCES = 15;
export const PREFERENCE_CHARS = 1500;

export type Preference = { id: string; profile?: string | null; state?: string | null; page_id?: string | null; superseded_by?: string | null; contested?: string | null; text?: string | null; at?: number | null; used_at?: number | null; deleted?: boolean | number };

export const preferenceLine = (text: string) => `- ${text.replace(/\s+/g, ' ').trim()}`;

// The profile's live, current, uncontested Memory claims that chats get: the 15 newest, stopping at the claim that would pass 1500 characters.
export function givenPreferences<T extends Preference>(facts: T[], profile: string, now = Date.now()): T[] {
  const live = facts.filter((f) => !f.deleted && f.profile === profile && (f.state ?? 'live') === 'live' && !f.page_id && !f.superseded_by && !f.contested && !isOld(f, now) && typeof f.text === 'string');
  const given: T[] = [];
  let chars = 0;
  for (const f of live.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, PREFERENCES)) {
    const length = preferenceLine(f.text as string).length;
    if (chars + length > PREFERENCE_CHARS) break;
    given.push(f);
    chars += length;
  }
  return given;
}
