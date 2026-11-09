import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getMeta, setMeta } from '../core/db.js';
import { run } from './slack.js';
import { PROFILE } from './slackSave.js';
import { DAY } from '../core/time.js';
import { applyChanges, type Change } from '../core/sync.js';
import { voicePage } from './voice.js';

const META = 'draft:rules';
const MAX_RULES = 10;
const MIN_PAIRS = 3;
const LAST = 'corrections:last';

export type Pair = { original: string; final: string | null; reason: string | null };

// The rules from the last corrections run, as a line for the draft step; empty when none ran yet.
export function correctionLines(db: Database): string[] {
  const raw = getMeta(db, META);
  if (!raw) return [];
  try {
    const { rules } = JSON.parse(raw) as { rules: string[]; at: number };
    if (!rules.length) return [];
    return [`When drafting, also follow these corrections I made to earlier drafts: ${rules.map((r, i) => `${i + 1}. ${r}`).join(' ')}`];
  } catch {
    return [];
  }
}

// Drafts of the last 14 days that I edited before sending (final is what went out) or skipped (final is null).
export function gatherPairs(db: Database, now: number): Pair[] {
  const rows = db.prepare("SELECT draft_text, text, status, why, skip_reason FROM replies WHERE profile = ? AND draft_text IS NOT NULL AND draft_text != '' AND at >= ? ORDER BY at").all(PROFILE, now - 14 * DAY) as { draft_text: string; text: string | null; status: string; why: string | null; skip_reason: string | null }[];
  const pairs: Pair[] = [];
  for (const r of rows) {
    if (r.status === 'skipped') pairs.push({ original: r.draft_text, final: null, reason: r.skip_reason || r.why });
    else if (r.text && r.text.trim() !== r.draft_text.trim()) pairs.push({ original: r.draft_text, final: r.text, reason: null });
  }
  return pairs;
}

export function correctionsPrompt(pairs: Pair[]) {
  const list = pairs.map((p, i) => `${i + 1}. Draft: ${p.original}\n   ${p.final == null ? `Skipped: ${p.reason ?? 'no reason given'}` : `I sent: ${p.final}`}`);
  return [
    'Below are Slack reply drafts the assistant wrote for me, with what I did to each: sent an edited version, or skipped it.',
    '',
    ...list,
    '',
    `Work out what the drafter should do differently: length, tone, what to leave out, when not to draft at all. Then call save_rules once with up to ${MAX_RULES} rules. Do not use the em dash character.`,
  ].join('\n');
}

// Stores the rules for the draft step and proposes each as a claim on the "How I write" page, once per rule text.
export function saveRules(db: Database, rules: string[], now = Date.now()) {
  const list = rules.map((r) => r.trim()).filter(Boolean).slice(0, MAX_RULES);
  setMeta(db, META, JSON.stringify({ rules: list, at: now }));
  const page = voicePage(db, now);
  const changes: Change[] = [];
  for (const text of list) {
    const id = `rule:${createHash('sha1').update(text.toLowerCase()).digest('hex').slice(0, 16)}`;
    if (db.prepare('SELECT 1 FROM facts WHERE profile = ? AND id = ?').get(PROFILE, id)) continue;
    changes.push({ table: 'facts', id, profile: PROFILE, updated_at: now, fields: { text, page_id: page, heading: 'Corrections', sources: JSON.stringify([{ kind: 'slack', label: 'my edits to drafts' }]), at: now, state: 'proposed', replaces: null, added_by: 'corrections' } });
  }
  return applyChanges(db, changes).applied;
}

// Reads the last two weeks of edited and skipped drafts and turns the differences into rules for the drafter.
export async function learnCorrections(db: Database, now = Date.now()) {
  const pairs = gatherPairs(db, now);
  if (pairs.length < MIN_PAIRS) return { pairs: 0 };
  let rules: string[] | null = null;
  const save = tool('save_rules', 'Save the rules for the drafter.', {
    rules: z.array(z.string().max(200)).max(MAX_RULES).describe('Each rule as one sentence of instruction to the drafter, starting with a verb, e.g. "Answer a yes or no question with one line and no explanation"'),
  }, async (a) => {
    rules = a.rules;
    return { content: [{ type: 'text' as const, text: 'saved' }] };
  });
  await run(correctionsPrompt(pairs), 'sonnet', [save], 5, () => rules != null);
  if (!rules) throw new Error('No rules were saved');
  return { pairs: pairs.length, rules: (rules as string[]).length, proposed: saveRules(db, rules, now) };
}

// Due at the first scan on a Monday, at most once a week.
export const correctionsDue = (last: number, now: number) => new Date(now).getDay() === 1 && now - last >= 6 * DAY;

// The weekly run from the scan loop; a failure is logged and the scan goes on.
export async function weeklyCorrections(db: Database, now = Date.now()) {
  if (!correctionsDue(Number(getMeta(db, LAST) ?? 0), now)) return;
  setMeta(db, LAST, String(now));
  try {
    const r = await learnCorrections(db, now);
    console.log(`corrections: ${r.pairs} pairs`);
  } catch (err) {
    console.error('corrections:', err);
  }
}
