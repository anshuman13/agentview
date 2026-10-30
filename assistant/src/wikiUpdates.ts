import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { decisionKey, keyWords, mayChange, titleWords } from '../../shared/claimMatch.js';
import { configDir, guardLimit, isLimited, stopOnOverage } from '../../server/src/agent/claude/accounts.js';
import { ACCOUNT_OF } from './calendar.js';
import type { Profile } from './db.js';
import { applyChanges, type Change } from './sync.js';
import { DAY } from './time.js';

const WITHIN = 14 * DAY;
const MAX_CLAIMS = 20;

type Meeting = { id: string; title: string | null; starts_at: number; calendar_url: string | null; decisions: string };
type Claim = { id: string; text: string; page_id: string; heading: string | null; at: number | null; updated_at: number; title: string };
export type Candidate = { claim: Claim; decisions: string[] };
export type Update = { claim: string; text: string };

const doneKey = (profile: Profile, id: string) => `wikiupdate:${profile}:${id}`;
const list = (s: string) => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : [];
  } catch {
    return [];
  }
};

// Meetings of the last two weeks with decisions that were not looked at yet.
export function pendingMeetings(db: Database, profile: Profile, now = Date.now()): Meeting[] {
  const rows = db.prepare(
    "SELECT id, title, starts_at, calendar_url, decisions FROM meetings WHERE profile = ? AND deleted = 0 AND starts_at >= ? AND COALESCE(ends_at, starts_at) <= ? AND decisions IS NOT NULL AND decisions NOT IN ('', '[]') ORDER BY starts_at",
  ).all(profile, now - WITHIN, now) as Meeting[];
  const done = db.prepare('SELECT 1 FROM meta WHERE key = ?');
  return rows.filter((m) => !done.get(doneKey(profile, m.id)));
}

export const markDone = (db: Database, profile: Profile, id: string, now = Date.now()) =>
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(doneKey(profile, id), String(now));

// Current claims on live pages from before the meeting that a decision may change, with the decisions that touch each.
export function candidates(db: Database, profile: Profile, m: Meeting): Candidate[] {
  const claims = db.prepare(
    "SELECT f.id, f.text, f.page_id, f.heading, f.at, f.updated_at, p.title FROM facts f JOIN pages p ON p.profile = f.profile AND p.id = f.page_id AND p.deleted = 0 AND COALESCE(p.state, 'live') = 'live' WHERE f.profile = ? AND f.deleted = 0 AND COALESCE(f.state, 'live') = 'live' AND (f.superseded_by IS NULL OR f.superseded_by = '') AND f.text IS NOT NULL AND p.title IS NOT NULL",
  ).all(profile) as Claim[];
  const decisions = list(m.decisions).map((text) => ({ text, key: decisionKey(text, m.title) }));
  const out: Candidate[] = [];
  for (const c of claims) {
    if (Math.max(c.at ?? 0, c.updated_at) >= m.starts_at) continue;
    const words = keyWords(c.text);
    const title = titleWords(c.title);
    const hits = decisions.filter((d) => mayChange(d.key, words, title)).map((d) => d.text);
    if (hits.length) out.push({ claim: c, decisions: hits });
  }
  return out.sort((a, b) => (b.claim.at ?? 0) - (a.claim.at ?? 0)).slice(0, MAX_CLAIMS);
}

const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();
const dateOf = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// Saves each update as a proposed claim that replaces the old one, unless the same text already replaces it.
export function saveUpdates(db: Database, profile: Profile, m: Meeting, found: Candidate[], updates: Update[], now = Date.now()) {
  const byId = new Map(found.map((c) => [c.claim.id, c.claim]));
  const same = db.prepare('SELECT text FROM facts WHERE profile = ? AND replaces = ? AND deleted = 0');
  const changes: Change[] = [];
  const seen = new Set<string>();
  for (const u of updates) {
    const old = byId.get(u.claim);
    const text = u.text.trim();
    if (!old || !text || norm(text) === norm(old.text)) continue;
    const key = `${old.id}\n${norm(text)}`;
    if (seen.has(key) || (same.all(profile, old.id) as { text: string | null }[]).some((r) => norm(r.text ?? '') === norm(text))) continue;
    seen.add(key);
    changes.push({
      table: 'facts', id: `upd:${createHash('sha1').update(`${m.id}\n${key}`).digest('hex').slice(0, 16)}`, profile, updated_at: now,
      fields: {
        text, page_id: old.page_id, heading: old.heading, at: now, state: 'proposed', replaces: old.id, added_by: `meeting:${m.id}`,
        sources: JSON.stringify([{ kind: 'meeting', label: m.title || 'Meeting', ...(m.calendar_url && { url: m.calendar_url }) }]),
      },
    });
  }
  return applyChanges(db, changes).applied;
}

async function decide(profile: Profile, m: Meeting, found: Candidate[]) {
  const account = ACCOUNT_OF[profile];
  guardLimit(account);
  const dir = configDir(account);
  const updates: Update[] = [];
  const save = tool('save_update', 'Save the replacement for one claim that a decision changes.', {
    claim: z.string().describe('The claim id in brackets'),
    text: z.string().max(400).describe('The replacement claim'),
  }, async (a) => {
    updates.push(a);
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const prompt = [
    `The meeting "${m.title ?? 'Meeting'}" on ${dateOf(m.starts_at)} made the decisions listed under each wiki claim below.`,
    'For each claim, decide whether those decisions change it: update a number, owner, date, status or plan in it, contradict it, or end it.',
    `When they do, call save_update with the claim id and the replacement claim: one or two specific sentences starting "As of ${dateOf(m.starts_at)}," that keep the still true detail from the old claim and lead with the subject.`,
    'When they do not, or you are unsure, save nothing for that claim. Do not use the em dash character. Do not do anything else.',
    '',
    ...found.flatMap((c) => [`[${c.claim.id}] (page ${c.claim.title}) ${c.claim.text}`, ...c.decisions.map((d) => `  - decision: ${d}`)]),
  ].join('\n');
  for await (const msg of query({
    prompt,
    options: {
      persistSession: false,
      model: 'haiku',
      maxTurns: 4 + found.length,
      cwd: os.tmpdir(),
      settingSources: [],
      tools: [],
      thinking: { type: 'disabled' },
      env: { ...process.env, ENABLE_TOOL_SEARCH: 'false', ...(dir && { CLAUDE_CONFIG_DIR: dir }) },
      mcpServers: { wiki: createSdkMcpServer({ name: 'wiki', tools: [save] }) },
      allowedTools: ['mcp__wiki__save_update'],
      permissionMode: 'dontAsk',
    },
  })) {
    stopOnOverage(account, msg);
    if (msg.type === 'result' && msg.subtype !== 'success' && !updates.length) throw new Error(`Wiki update ended with ${msg.subtype}`);
  }
  return updates;
}

// Proposes wiki updates from each recent meeting's decisions, once per meeting. A meeting stopped by the usage limit waits for the next run.
export async function proposeWikiUpdates(db: Database, now = Date.now(), ask = decide) {
  let saved = 0;
  for (const profile of Object.keys(ACCOUNT_OF) as Profile[]) {
    for (const m of pendingMeetings(db, profile, now).slice(0, 5)) {
      const found = candidates(db, profile, m);
      try {
        if (found.length) saved += saveUpdates(db, profile, m, found, await ask(profile, m, found), now);
      } catch (err) {
        console.error(`wiki updates ${profile}:`, err instanceof Error ? err.message : err);
        if (isLimited(ACCOUNT_OF[profile])) break;
      }
      markDone(db, profile, m.id, now);
    }
  }
  return saved;
}
