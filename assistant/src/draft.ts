import type { Database } from 'bun:sqlite';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { keyWords } from '../../shared/claimMatch.js';
import { textList } from './db.js';
import { DAY } from './time.js';

const PROFILE = 'work' as const;
const MAX = 3;
const RECENT = 30 * DAY;

export const DRAFT_DESC = 'A reply I could send, in my voice: 2 to 4 sentences in the language of the ask';
export const DRAFT_STEP = 'For each new ask, read its thread, call ask_context with the words of the ask, and write draft from the thread and what ask_context returns. Do not promise dates or facts you do not know.';

// Current wiki claims and meeting decisions of the last 30 days that share at least two key words with the ask, best first.
export function askContext(db: Database, ask: string, now = Date.now()) {
  const words = keyWords(ask);
  const best = (list: { hay: string; line: string }[]) => list
    .map((x) => ({ line: x.line, n: [...keyWords(x.hay)].filter((w) => words.has(w)).length }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX)
    .map((x) => x.line);
  const claims = db.prepare(
    "SELECT f.text, p.title FROM facts f JOIN pages p ON p.profile = f.profile AND p.id = f.page_id AND p.deleted = 0 AND COALESCE(p.state, 'live') = 'live' WHERE f.profile = ? AND f.deleted = 0 AND COALESCE(f.state, 'live') = 'live' AND (f.superseded_by IS NULL OR f.superseded_by = '') AND f.text IS NOT NULL",
  ).all(PROFILE) as { text: string; title: string | null }[];
  const meetings = db.prepare("SELECT title, decisions FROM meetings WHERE profile = ? AND deleted = 0 AND starts_at BETWEEN ? AND ? AND decisions IS NOT NULL AND decisions NOT IN ('', '[]')").all(PROFILE, now - RECENT, now) as { title: string | null; decisions: string }[];
  return {
    claims: best(claims.map((c) => ({ hay: `${c.title ?? ''} ${c.text}`, line: `${c.title ? `${c.title}: ` : ''}${c.text}` }))),
    decisions: best(meetings.flatMap((m) => textList(m.decisions).map((d) => ({ hay: d, line: `${d} (${m.title ?? 'meeting'})` })))),
  };
}

export const contextTool = (db: Database, now = Date.now()) =>
  tool('ask_context', 'Wiki claims and meeting decisions that match an ask, for its reply draft.', { ask: z.string().describe('The ask in its own words') }, async ({ ask }) => {
    const { claims, decisions } = askContext(db, ask, now);
    const text = [...claims.map((c) => `Wiki: ${c}`), ...decisions.map((d) => `Decided: ${d}`)].join('\n');
    return { content: [{ type: 'text' as const, text: text || 'Nothing matches.' }] };
  });
