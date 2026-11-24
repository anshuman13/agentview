import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { isLimited } from '../../../server/src/agent/claude/accounts.js';
import { ACCOUNT_OF } from '../calendar/calendar.js';
import { ask } from '../core/claude.js';
import { getMeta, pruneMeta, setMeta, type Profile } from '../core/db.js';
import { applyChanges, type Change } from '../core/sync.js';
import { norm, samePage, similarClaim } from '../../../shared/claimMatch.js';
import { decisionHistory, examplesFor, proposalRun, TICKET_OR_PR } from '../../../shared/proposalGate.js';
import { searchWiki } from './wikiSearch.js';

const MAX_CLAIMS = 1;
// Memory proposals from chats per profile per day, so Review gets a few good ones, not a pile.
const DAILY_MEMORY = 2;
const MAX_DECISIONS = 2;
const SECRET = /[a-z0-9]{24,}|sk-|ghp_|xox|password/i;

export type ChatEvent = { id: string; kind: string; text: string; at: number };
export type Chat = { chat: string; title: string; folder?: string; profile: Profile; events: ChatEvent[] };
export type Taught = { text: string; why?: string };
export type Decision = Taught & { page: string; section?: string };
type Page = { id: string; title: string; section?: string };
type Learned = { proposed: number } | { skipped: 'limit' };

const cursorKey = (profile: Profile, chat: string) => `learn:${profile}:${chat}`;
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

function known(db: Database, profile: Profile) {
  return db.prepare("SELECT id, text, added_by, state, updated_at, decided_at, reject_reason, page_id, at FROM facts WHERE profile = ? AND deleted = 0 AND text IS NOT NULL AND text != ''").all(profile) as { id: string; text: string; added_by: string | null; state: string | null; updated_at: number; decided_at: number | null; reject_reason: string | null; page_id: string | null; at: number | null }[];
}

// The profile's approved and rejected proposals, for the proposal gate and the prompt examples.
export const proposalHistory = (db: Database, profile: Profile) => decisionHistory(known(db, profile));

// The claims Haiku is told are already known: the profile's live and proposed claims, page or not.
export const alreadyKnown = (rows: { text: string; state: string | null }[]) => rows.filter((f) => f.state === null || f.state === 'live' || f.state === 'proposed').map((f) => f.text);

// Saves each claim as a proposed claim from the chat, unless a claim with the same text exists in any state, it looks like a secret or the proposal gate skips it. Preferences go to memory; a decision goes to its wiki page, which a new title creates as a proposed page.
function saveLearned(db: Database, c: Chat, claims: Taught[], decisions: Decision[], now = Date.now()) {
  const rows = known(db, c.profile);
  const seen = new Set(rows.map((f) => norm(f.text)));
  const gate = proposalRun(decisionHistory(rows), 'chat');
  const pages = db.prepare("SELECT id, title FROM pages WHERE profile = ? AND deleted = 0 AND COALESCE(state, 'live') != 'rejected'").all(c.profile) as Page[];
  const changes: Change[] = [];
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  let today = rows.filter((f) => f.id.startsWith('learn:') && f.added_by?.startsWith('claude:') && f.page_id == null && (f.at ?? 0) >= dayStart).length;
  const add = ({ text: raw, why }: Taught, page: Decision | null) => {
    const text = raw.trim().replace(/\s+/g, ' ');
    if (!text || SECRET.test(text) || seen.has(norm(text)) || gate.skip(text, page != null)) return false;
    // A restatement of any claim, live, proposed or rejected, adds nothing.
    if (!page && similarClaim(text, rows)) return false;
    if (!page && today >= DAILY_MEMORY) return false;
    if (!page) today++;
    let page_id: string | null = null;
    if (page) {
      const title = page.page.trim().toLowerCase();
      page_id = pages.find((p) => p.id === page.page)?.id ?? samePage(page.page, pages)?.id ?? null;
      if (!page_id) {
        if (!title || !page.section?.trim()) return false;
        page_id = `learn:page:${hash(`${c.profile}:${title}`)}`;
        pages.push({ id: page_id, title: page.page.trim() });
        changes.push({ table: 'pages', id: page_id, profile: c.profile, updated_at: now, fields: { title: page.page.trim(), section: page.section.trim(), summary: null, sort: now, state: 'proposed' } });
      }
    }
    seen.add(norm(text));
    changes.push({
      table: 'facts', id: `learn:${hash(norm(text))}`, profile: c.profile, updated_at: now,
      fields: { text, page_id, heading: null, at: now, state: 'proposed', replaces: null, added_by: `claude:${c.chat}`, why: why?.trim().slice(0, 200) || null, sources: JSON.stringify([{ kind: 'chat', label: c.title, ...(c.folder && { folder: c.folder }) }]) },
    });
    return true;
  };
  let n = 0;
  for (const t of claims) if (n < MAX_CLAIMS && add(t, null)) n++;
  n = 0;
  for (const d of decisions) if (n < MAX_DECISIONS && add(d, d)) n++;
  gate.log();
  return applyChanges(db, changes).applied;
}

async function decide(c: Chat, events: ChatEvent[], memory: string[], pages: Page[] | null, now: number, examples: string[] = []) {
  const claims: Taught[] = [];
  const decisions: Decision[] = [];
  const why = z.string().max(200).describe('My words in the chat that taught or settled it, one short sentence');
  const save = tool('save_claim', 'Save one preference or correction the user taught in the chat.', {
    text: z.string().max(400).describe('One or two sentences that lead with the subject'),
    why,
  }, async (a) => {
    claims.push(a);
    return { content: [{ type: 'text' as const, text: 'saved' }] };
  });
  const saveDecision = tool('save_decision', 'Save one decision or status settled in the chat, on a wiki page.', {
    text: z.string().max(400).describe('One or two sentences that start with "As of <date>," and name the ticket or PR'),
    page: z.string().describe('The id of one of the listed pages, or the title of a new page'),
    section: z.string().optional().describe('Section for a new page'),
    why,
  }, async (a) => {
    decisions.push(a);
    return { content: [{ type: 'text' as const, text: 'saved' }] };
  });
  const prompt = [
    'Below is a chat between me and Claude. Find a rule I set for how Claude should work in every project from now on, such as a tool to use, a writing style, or a habit to avoid.',
    'Save it only when all of these hold: I stated it as a rule (always, never, from now on, I want, do not), it still applies next month in a different project, and a new Claude chat would get it wrong without it.',
    'Never save: a reaction to one answer, a bug report or feature request, a plan, trip, booking or event detail, a fact about one project or system, a goal or loop instruction, or anything already known in other words.',
    `When one qualifies, call save_claim once with one or two specific sentences that lead with the subject, and why: my words that taught it. Save at most ${MAX_CLAIMS}. Most chats teach nothing; then save nothing.`,
    ...(pages ? [
      `The chat also names a ticket or pull request. Find the decisions or status it settled, such as what we use for what, who owns it or what shipped. For each, call save_decision with one or two specific sentences that start with "As of ${new Date(now).toISOString().slice(0, 10)}," and carry the ticket or PR id. Save at most ${MAX_DECISIONS}.`,
      'Give each decision a page: the id of a listed page it belongs on, else a new page title with its section. Skip a decision that is only an idea or a question.',
      '',
      'Wiki pages:',
      ...(pages.length ? pages.map((p) => `- ${p.id}: ${p.title}${p.section ? ` (${p.section})` : ''}`) : ['(none)']),
      '',
    ] : []),
    'Save nothing when I taught or settled nothing. Never save a secret, credential, token, password, URL with a key in it or file contents. Skip what is already known. Do not use the em dash character. Do not do anything else.',
    '',
    'Already known:',
    ...(memory.length ? memory.map((t) => `- ${t}`) : ['(nothing)']),
    '',
    ...examples,
    '',
    'Chat:',
    ...events.map((e) => `${e.kind === 'user' ? 'Me' : 'Claude'}: ${e.text}`),
  ].join('\n');
  for await (const msg of ask(ACCOUNT_OF[c.profile], prompt, {
    model: 'haiku',
    maxTurns: 6,
    cwd: os.tmpdir(),
    tools: [],
    thinking: { type: 'disabled' },
    env: { ENABLE_TOOL_SEARCH: 'false' },
    mcpServers: { wiki: createSdkMcpServer({ name: 'wiki', tools: pages ? [save, saveDecision] : [save] }) },
    allowedTools: ['mcp__wiki__save_claim', ...(pages ? ['mcp__wiki__save_decision'] : [])],
    permissionMode: 'dontAsk',
  }, undefined, 'learn')) {
    if (msg.type === 'result' && msg.subtype !== 'success' && !claims.length && !decisions.length) throw new Error(`Learning from a chat ended with ${msg.subtype}`);
  }
  return { claims, decisions };
}

// Up to 5 wiki pages the chat may belong on, or null when the chat names no ticket or pull request.
function decisionPages(db: Database, c: Chat, events: ChatEvent[]) {
  const said = events.filter((e) => e.kind === 'user').map((e) => e.text);
  if (!said.some((t) => TICKET_OR_PR.test(t))) return null;
  const query = `${c.title} ${said.join(' ')}`;
  return searchWiki(db, query, c.profile).pages.slice(0, 5) as Page[];
}

// Reads the user and assistant events of a chat after the cursor and proposes what the user taught as memory claims. The cursor moves only after a run that finished.
export async function learnFromChat(db: Database, c: Chat, now = Date.now(), run = decide): Promise<Learned> {
  const key = cursorKey(c.profile, c.chat);
  const cursor = Number(getMeta(db, key) ?? 0);
  const events = c.events.filter((e) => (e.kind === 'user' || e.kind === 'assistant') && e.at > cursor);
  if (!events.some((e) => e.kind === 'user')) return { proposed: 0 };
  if (isLimited(ACCOUNT_OF[c.profile])) return { skipped: 'limit' };
  const rows = known(db, c.profile);
  const { claims, decisions } = await run(c, events, alreadyKnown(rows), decisionPages(db, c, events), now, examplesFor(decisionHistory(rows), 'chat'));
  const proposed = saveLearned(db, c, claims, decisions, now);
  setMeta(db, key, String(Math.max(...events.map((e) => e.at))));
  // A cursor only skips events already read, so one for a chat quiet for three months can go.
  pruneMeta(db, `learn:${c.profile}:`, now - 90 * 86_400_000);
  return { proposed };
}
