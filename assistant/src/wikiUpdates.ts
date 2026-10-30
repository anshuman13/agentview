import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { decisionKey, keyWords, mayChange, titleWords } from '../../shared/claimMatch.js';
import { errText } from '../../shared/util.js';
import { isLimited } from '../../server/src/agent/claude/accounts.js';
import { ACCOUNT_OF } from './calendar.js';
import { ask } from './claude.js';
import { deleteMeta, getMeta, pruneMeta, setMeta, textList, type Profile } from './db.js';
import { applyChanges, type Change } from './sync.js';
import { DAY } from './time.js';

const WITHIN = 14 * DAY;
const MAX_CLAIMS = 20;
const MAX_TRIES = 3;

type Meeting = { id: string; title: string | null; starts_at: number; calendar_url: string | null; decisions: string };
type SlackDecision = { id: string; text: string; channel: string; url: string; at: number };
// A meeting or a Slack message whose decisions may change claims. id keys the done mark; by is the claim's added_by.
export type Origin = { id: string; by: string; title: string | null; at: number; decisions: string[]; what: string; source: { kind: 'meeting' | 'slack'; label: string; url?: string } };
type Claim = { id: string; text: string; page_id: string; heading: string | null; at: number | null; updated_at: number; title: string };
export type Candidate = { claim: Claim; decisions: string[] };
export type Update = { claim: string; text: string };

const doneKey = (profile: Profile, id: string) => `wikiupdate:${profile}:${id}`;

const dateOf = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const fromMeeting = (m: Meeting): Origin => ({
  id: m.id, by: `meeting:${m.id}`, title: m.title, at: m.starts_at, decisions: textList(m.decisions).map((x) => x.trim()),
  what: `The meeting "${m.title ?? 'Meeting'}" on ${dateOf(m.starts_at)}`,
  source: { kind: 'meeting', label: m.title || 'Meeting', ...(m.calendar_url && { url: m.calendar_url }) },
});

const fromSlack = (d: SlackDecision): Origin => ({
  id: `slack:${d.id}`, by: `slack:${d.id}`, title: d.channel, at: d.at, decisions: [d.text],
  what: `A message in ${d.channel} on ${dateOf(d.at)}`,
  source: { kind: 'slack', label: d.channel, url: d.url },
});

// Meetings and Slack decisions of the last two weeks that were not looked at yet, oldest first.
export function pendingOrigins(db: Database, profile: Profile, now = Date.now()): Origin[] {
  const meetings = db.prepare(
    "SELECT id, title, starts_at, calendar_url, decisions FROM meetings WHERE profile = ? AND deleted = 0 AND starts_at >= ? AND COALESCE(ends_at, starts_at) <= ? AND decisions IS NOT NULL AND decisions NOT IN ('', '[]') ORDER BY starts_at",
  ).all(profile, now - WITHIN, now) as Meeting[];
  const slack = db.prepare('SELECT id, text, channel, url, at FROM slack_decisions WHERE profile = ? AND at >= ? AND at <= ?').all(profile, now - WITHIN, now) as SlackDecision[];
  return [...meetings.map(fromMeeting), ...slack.map(fromSlack)].filter((o) => getMeta(db, doneKey(profile, o.id)) == null).sort((a, b) => a.at - b.at);
}

const triesKey = (profile: Profile, id: string) => `wikiupdate-tries:${profile}:${id}`;

export function markDone(db: Database, profile: Profile, id: string, now = Date.now()) {
  setMeta(db, doneKey(profile, id), String(now));
  deleteMeta(db, triesKey(profile, id));
}

function failed(db: Database, profile: Profile, id: string) {
  const key = triesKey(profile, id);
  const n = Number(getMeta(db, key) ?? 0) + 1;
  setMeta(db, key, String(n));
  return n;
}

// Current claims on live pages from before the decision, with no proposed replacement yet, that it may change, with the decisions that touch each.
export function candidates(db: Database, profile: Profile, o: Origin): Candidate[] {
  const claims = db.prepare(
    "SELECT f.id, f.text, f.page_id, f.heading, f.at, f.updated_at, p.title FROM facts f JOIN pages p ON p.profile = f.profile AND p.id = f.page_id AND p.deleted = 0 AND COALESCE(p.state, 'live') = 'live' WHERE f.profile = ? AND f.deleted = 0 AND COALESCE(f.state, 'live') = 'live' AND (f.superseded_by IS NULL OR f.superseded_by = '') AND NOT EXISTS (SELECT 1 FROM facts r WHERE r.profile = f.profile AND r.replaces = f.id AND r.deleted = 0 AND r.state = 'proposed') AND f.text IS NOT NULL AND p.title IS NOT NULL",
  ).all(profile) as Claim[];
  const decisions = o.decisions.map((text) => ({ text, key: decisionKey(text, o.title) }));
  const out: Candidate[] = [];
  for (const c of claims) {
    if (Math.max(c.at ?? 0, c.updated_at) >= o.at) continue;
    const words = keyWords(c.text);
    const title = titleWords(c.title);
    const hits = decisions.filter((d) => mayChange(d.key, words, title)).map((d) => d.text);
    if (hits.length) out.push({ claim: c, decisions: hits });
  }
  return out.sort((a, b) => (b.claim.at ?? 0) - (a.claim.at ?? 0)).slice(0, MAX_CLAIMS);
}

const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();

// Saves each update as a proposed claim that replaces the old one, unless the same text already replaces it.
export function saveUpdates(db: Database, profile: Profile, o: Origin, found: Candidate[], updates: Update[], now = Date.now()) {
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
      table: 'facts', id: `upd:${createHash('sha1').update(`${o.id}\n${key}`).digest('hex').slice(0, 16)}`, profile, updated_at: now,
      fields: {
        text, page_id: old.page_id, heading: old.heading, at: now, state: 'proposed', replaces: old.id, added_by: o.by,
        sources: JSON.stringify([o.source]),
      },
    });
  }
  return applyChanges(db, changes).applied;
}

async function decide(profile: Profile, o: Origin, found: Candidate[]) {
  const account = ACCOUNT_OF[profile];
  const updates: Update[] = [];
  const save = tool('save_update', 'Save the replacement for one claim that a decision changes.', {
    claim: z.string().describe('The claim id in brackets'),
    text: z.string().max(400).describe('The replacement claim'),
  }, async (a) => {
    updates.push(a);
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const prompt = [
    `${o.what} made the decisions listed under each wiki claim below.`,
    'For each claim, decide whether those decisions change it: update a number, owner, date, status or plan in it, contradict it, or end it.',
    `When they do, call save_update with the claim id and the replacement claim: one or two specific sentences starting "As of ${dateOf(o.at)}," that keep the still true detail from the old claim and lead with the subject.`,
    'When they do not, or you are unsure, save nothing for that claim. Do not use the em dash character. Do not do anything else.',
    '',
    ...found.flatMap((c) => [`[${c.claim.id}] (page ${c.claim.title}) ${c.claim.text}`, ...c.decisions.map((d) => `  - decision: ${d}`)]),
  ].join('\n');
  for await (const msg of ask(account, prompt, {
    model: 'haiku',
    maxTurns: 4 + found.length,
    cwd: os.tmpdir(),
    tools: [],
    thinking: { type: 'disabled' },
    env: { ENABLE_TOOL_SEARCH: 'false' },
    mcpServers: { wiki: createSdkMcpServer({ name: 'wiki', tools: [save] }) },
    allowedTools: ['mcp__wiki__save_update'],
    permissionMode: 'dontAsk',
  })) {
    if (msg.type === 'result' && msg.subtype !== 'success' && !updates.length) throw new Error(`Wiki update ended with ${msg.subtype}`);
  }
  return updates;
}

// Proposes wiki updates from the decisions of each recent meeting and Slack message, once each. One stopped by the usage limit waits for the next run;
// one that fails otherwise is tried again on the next runs, up to MAX_TRIES in all.
export async function proposeWikiUpdates(db: Database, now = Date.now(), ask = decide) {
  let saved = 0;
  for (const profile of Object.keys(ACCOUNT_OF) as Profile[]) {
    // An origin is marked done after it happened, so a mark older than the window is never looked up again.
    pruneMeta(db, `wikiupdate:${profile}:`, now - WITHIN);
    for (const o of pendingOrigins(db, profile, now).slice(0, 5)) {
      const found = candidates(db, profile, o);
      try {
        if (found.length) saved += saveUpdates(db, profile, o, found, await ask(profile, o, found), now);
      } catch (err) {
        console.error(`wiki updates ${profile}:`, errText(err));
        if (isLimited(ACCOUNT_OF[profile])) break;
        if (failed(db, profile, o.id) < MAX_TRIES) continue;
      }
      markDone(db, profile, o.id, now);
    }
  }
  return saved;
}
