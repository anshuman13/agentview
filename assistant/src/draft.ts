import type { Database } from 'bun:sqlite';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { keyWords } from '../../shared/claimMatch.js';
import { textList } from './db.js';
import { DAY } from './time.js';

const PROFILE = 'work' as const;
const MAX = 3;
const RECENT = 30 * DAY;
const FAQ_PAGE = 'Support FAQ';

export type Claim = { id: string; line: string; url: string | null };

const firstUrl = (sources: string | null) => {
  try {
    const list = JSON.parse(sources ?? '[]') as { url?: string }[];
    return list.find((s) => s.url)?.url ?? null;
  } catch {
    return null;
  }
};

export const DRAFT_DESC = 'A reply I could send, in my voice: 2 to 4 sentences in the language of the ask';
export const DRAFT_STEP = 'For each new ask, read its thread, call ask_context with the words of the ask, and write draft from the thread and what ask_context returns. Do not promise dates or facts you do not know. Set tier, confidence and why for each ask: confidence is high only when the draft rests on the thread or on what ask_context returned. Set answered_by_other when a reply from someone other than me already answers it in the thread. In claims list the ids of the wiki claims the draft rests on, as ask_context gave them, and name them in why; a tier answer with no claim and nothing in the thread is a hold. For a hold the draft is one short line that says I will look at it or get back to them, not an answer. When the claim has a link, end the draft with "see <link>".';

// Current wiki claims and meeting decisions of the last 30 days that share at least two key words with the ask, best first;
// a Support FAQ claim wins a tie. Claims carry their id and first source link so the draft can cite them.
export function askContext(db: Database, ask: string, now = Date.now()) {
  const words = keyWords(ask);
  const best = <T extends { hay: string; boost?: number }>(list: T[]) => list
    .map((x) => ({ x, n: [...keyWords(x.hay)].filter((w) => words.has(w)).length }))
    .filter((r) => r.n >= 2)
    .sort((a, b) => b.n + (b.x.boost ?? 0) - a.n - (a.x.boost ?? 0))
    .slice(0, MAX)
    .map((r) => r.x);
  const claims = db.prepare(
    "SELECT f.id, f.text, f.sources, p.title FROM facts f JOIN pages p ON p.profile = f.profile AND p.id = f.page_id AND p.deleted = 0 AND COALESCE(p.state, 'live') = 'live' WHERE f.profile = ? AND f.deleted = 0 AND COALESCE(f.state, 'live') = 'live' AND (f.superseded_by IS NULL OR f.superseded_by = '') AND f.text IS NOT NULL",
  ).all(PROFILE) as { id: string; text: string; sources: string | null; title: string | null }[];
  const meetings = db.prepare("SELECT title, decisions FROM meetings WHERE profile = ? AND deleted = 0 AND starts_at BETWEEN ? AND ? AND decisions IS NOT NULL AND decisions NOT IN ('', '[]')").all(PROFILE, now - RECENT, now) as { title: string | null; decisions: string }[];
  return {
    claims: best(claims.map((c) => ({ hay: `${c.title ?? ''} ${c.text}`, boost: c.title === FAQ_PAGE ? 0.5 : 0, id: c.id, line: `${c.title ? `${c.title}: ` : ''}${c.text}`, url: firstUrl(c.sources) }))).map(({ id, line, url }): Claim => ({ id, line, url })),
    decisions: best(meetings.flatMap((m) => textList(m.decisions).map((d) => ({ hay: d, line: `${d} (${m.title ?? 'meeting'})` })))).map((d) => d.line),
  };
}

// Ids among the given that are live claims now, for the check before an answer goes out.
export function liveClaims(db: Database, ids: string[]) {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT f.id FROM facts f JOIN pages p ON p.profile = f.profile AND p.id = f.page_id AND p.deleted = 0 AND COALESCE(p.state, 'live') = 'live' WHERE f.profile = ? AND f.deleted = 0 AND COALESCE(f.state, 'live') = 'live' AND (f.superseded_by IS NULL OR f.superseded_by = '') AND f.id IN (${ids.map(() => '?').join(',')})`).all(PROFILE, ...ids) as { id: string }[];
  return rows.map((r) => r.id);
}

export const contextTool = (db: Database, now = Date.now()) =>
  tool('ask_context', 'Wiki claims and meeting decisions that match an ask, for its reply draft. Each wiki line starts with the claim id to cite.', { ask: z.string().describe('The ask in its own words') }, async ({ ask }) => {
    const { claims, decisions } = askContext(db, ask, now);
    const text = [...claims.map((c) => `Wiki [${c.id}]: ${c.line}${c.url ? ` (see ${c.url})` : ''}`), ...decisions.map((d) => `Decided: ${d}`)].join('\n');
    return { content: [{ type: 'text' as const, text: text || 'Nothing matches.' }] };
  });
