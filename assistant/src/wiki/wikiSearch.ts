import type { Database } from 'bun:sqlite';
import { STOP } from '../../../shared/claimMatch.js';
import type { Profile } from '../core/db.js';
import { applyChanges } from '../core/sync.js';

const MAX_WORDS = 10;

export function ftsQuery(text: string) {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !STOP.has(w));
  return words.slice(0, MAX_WORDS).map((w) => (w.length >= 4 ? `"${w}"*` : `"${w}"`)).join(' OR ');
}

export function searchWiki(db: Database, query: string, profile: Profile) {
  const match = ftsQuery(query);
  if (!match) return { pages: [], claims: [] };
  const pages = db.prepare(
    "SELECT p.id, p.title, p.section, p.state FROM pages_fts JOIN pages p ON p.rowid = pages_fts.rowid WHERE pages_fts MATCH ? AND p.profile = ? AND p.deleted = 0 AND COALESCE(p.state, 'live') != 'rejected' ORDER BY bm25(pages_fts, 2, 1) LIMIT 10",
  ).all(match, profile) as Record<string, unknown>[];
  const claims = db.prepare(
    'SELECT f.id, f.text, f.at, f.used_at, f.state, f.superseded_by, f.contested, f.page_id, f.heading, p.title AS page_title FROM facts_fts JOIN facts f ON f.rowid = facts_fts.rowid LEFT JOIN pages p ON p.id = f.page_id WHERE facts_fts MATCH ? AND f.profile = ? AND f.deleted = 0 ORDER BY bm25(facts_fts, 2, 1), f.at DESC LIMIT 200',
  ).all(match, profile) as Record<string, unknown>[];
  return { pages, claims };
}

// Counts a day of use and stamps the time on each live, unsuperseded claim of profile among ids, for the stale rule (shared/claimAge.ts).
// A claim already used in the last day is skipped, and updated_at stays, so reads do not churn the sync.
export function markUsed(db: Database, profile: Profile, ids: string[], now = Date.now()) {
  const read = db.prepare("SELECT used_count, used_at, updated_at, state, superseded_by FROM facts WHERE profile = ? AND id = ? AND deleted = 0");
  const changes = [...new Set(ids)].flatMap((id) => {
    const found = read.get(profile, id) as { used_count: number | null; used_at: number | null; updated_at: number; state: string | null; superseded_by: string | null } | null;
    if (!found || (found.state ?? 'live') !== 'live' || found.superseded_by || (found.used_at != null && now - found.used_at < 86_400_000)) return [];
    return [{ table: 'facts', id, profile, updated_at: found.updated_at, fields: { used_count: (found.used_count ?? 0) + 1, used_at: now }, field_times: { used_count: now, used_at: now } }];
  });
  if (changes.length) applyChanges(db, changes);
  return changes.length;
}
