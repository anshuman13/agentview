import type { Database } from 'bun:sqlite';
import { STOP } from '../../../shared/claimMatch.js';
import type { Profile } from '../core/db.js';

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
    'SELECT f.id, f.text, f.at, f.state, f.superseded_by, f.page_id FROM facts_fts JOIN facts f ON f.rowid = facts_fts.rowid WHERE facts_fts MATCH ? AND f.profile = ? AND f.deleted = 0 ORDER BY bm25(facts_fts), f.at DESC LIMIT 200',
  ).all(match, profile) as Record<string, unknown>[];
  return { pages, claims };
}
