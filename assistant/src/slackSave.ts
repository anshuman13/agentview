import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DRAFT_DESC } from './draft.js';
import { applyChanges, type Change } from './sync.js';
import { DAY, parseWhen } from './time.js';

export const PROFILE = 'work' as const;

export const Chat = z.object({
  id: z.string().describe('Slack channel or DM id, like C0123 or D0123'),
  name: z.string().describe('#channel-name, or the other person for a DM'),
  kind: z.enum(['dm', 'channel', 'mention']),
  url: z.string().optional().describe('Permalink to the newest message'),
  summary: z.string().describe('The updated running summary: what is going on, who waits on me, what was decided. At most 3 short sentences.'),
  new_messages: z.number().describe('How many new messages you read in this chat since the last pass'),
});
export const Ask = z.object({
  url: z.string().describe('Permalink of the message'),
  from: z.string().describe('Who asked'),
  chat: z.string().describe('#channel-name, or "DM" for a direct message; never an id'),
  title: z.string().describe('Short imperative task for me'),
  quote: z.string().describe('The key sentence of the message'),
  urgent: z.boolean().describe('True only if someone is blocked on me, there is a deadline today, an incident, or I was pinged more than once'),
  draft: z.string().optional().describe(DRAFT_DESC),
});
// A commitment I made myself, like "I'll send it tomorrow".
export const Said = z.object({
  url: z.string().describe('Permalink of my message'),
  to: z.string().describe('Who I promised it to'),
  chat: z.string().describe('#channel-name, or "DM" for a direct message; never an id'),
  title: z.string().describe('Short imperative task for me, like "Send Kim the draft"'),
  quote: z.string().describe('My sentence with the promise'),
  due: z.string().optional().describe('When I said it would be done, as YYYY-MM-DD or YYYY-MM-DDTHH:MM local time; leave out when I named no time'),
});
export const Detail = z.object({
  id: z.string().describe('The id in brackets of the open ask or tracked task'),
  note: z.string().describe('The new detail in one sentence: a date, a requirement, a link, a change of scope or who owns it'),
  from: z.string().describe('Who said it'),
  url: z.string().describe('Permalink of the message'),
});
export const Decided = z.object({
  text: z.string().describe('What was decided, in one short line'),
  channel: z.string().describe('#channel-name; never an id'),
  url: z.string().describe('Permalink of the message with the decision'),
  time: z.string().describe('When it was decided, as YYYY-MM-DDTHH:MM local time'),
});
export type ScanResult = { chats: (Omit<z.infer<typeof Chat>, 'new_messages'> & { new_messages?: number })[]; asks: z.infer<typeof Ask>[]; answered: string[]; details?: z.infer<typeof Detail>[]; said?: z.infer<typeof Said>[]; decisions?: z.infer<typeof Decided>[]; channels?: { name: string; id: string }[] };

// Permalinks come from the model, so only web links are stored or pushed; no comma or semicolon, which split ntfy actions.
export const webUrl = (u: string | null | undefined) => (u && /^https?:\/\/[^\s,;]+$/i.test(u) ? u : null);

export const askId = (url: string) => `slack:${createHash('sha1').update(url).digest('hex').slice(0, 16)}`;
// My own promises keep the id of their source with this prefix, so the apps label them "You said".
export const saidId = (id: string) => `said:${id}`;

// Saves one scan: chat summaries, asks and my promises as items to review, new details on tasks and channel decisions, and
// closes asks I have replied to. Returns how many asks and promises are new and which asks are urgent.
export function saveScan(db: Database, r: ScanResult, now = Date.now()) {
  const has = db.prepare('SELECT status FROM items WHERE profile = ? AND id = ?');
  // A chat with nothing new keeps its running summary; one without an id is dropped.
  const changes: Change[] = r.chats.filter((c) => c.new_messages !== 0 && c.id.trim()).map((c) => ({ table: 'chats', id: c.id, profile: PROFILE, updated_at: now, fields: { name: c.name, kind: c.kind, url: webUrl(c.url), summary: c.summary.trim(), last_at: now } }));
  const urgent: (ScanResult['asks'][number] & { id: string })[] = [];
  let added = 0;
  for (const a of r.asks) {
    const id = askId(a.url);
    if (has.get(PROFILE, id) || changes.some((c) => c.id === id)) continue;
    changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { title: a.title.trim(), text: a.quote.trim(), source: 'slack', source_url: webUrl(a.url), people: `${a.from} · ${a.chat}`, at: null, status: 'suggested', draft: a.draft?.trim() || null } });
    added++;
    if (a.urgent) urgent.push({ ...a, id });
  }
  let said = 0;
  for (const p of r.said ?? []) {
    // A promise without a usable permalink is told apart by its sentence.
    const id = saidId(askId(webUrl(p.url) ?? `${p.url}\n${p.quote.trim()}`));
    if (has.get(PROFILE, id) || changes.some((c) => c.id === id)) continue;
    changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { title: p.title.trim(), text: p.quote.trim(), source: 'slack', source_url: webUrl(p.url), people: `${p.to} · ${p.chat}`, at: parseWhen(p.due), status: 'suggested' } });
    said++;
  }
  for (const url of r.answered) {
    const id = askId(url);
    const old = has.get(PROFILE, id) as { status: string } | null;
    if (old && (old.status === 'suggested' || old.status === 'unassigned')) changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { status: 'done' } });
  }
  // New details from Slack go at the end of the task's notes, once per message.
  const task = db.prepare("SELECT text FROM items WHERE profile = ? AND id = ? AND deleted = 0 AND status IN ('open', 'suggested')");
  const texts = new Map<string, string>();
  for (const d of r.details ?? []) {
    const row = task.get(PROFILE, d.id) as { text: string | null } | null;
    if (!row) continue;
    const text = texts.get(d.id) ?? row.text ?? '';
    if (text.includes(d.url)) continue;
    texts.set(d.id, `${text ? `${text}\n\n` : ''}${d.from} on Slack: ${d.note.trim()} ${d.url}`);
  }
  for (const [id, text] of texts) changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { text } });
  db.transaction(() => {
    applyChanges(db, changes);
    saveDecisions(db, r.decisions ?? [], now);
  })();
  return { added, urgent, said };
}

// Channel decisions with a web permalink are kept once per permalink for wiki updates, so a re-worded one is not looked at again; ones older than two weeks are dropped.
function saveDecisions(db: Database, list: z.infer<typeof Decided>[], now: number) {
  db.prepare('DELETE FROM slack_decisions WHERE at < ?').run(now - 14 * DAY);
  const seen = db.prepare('SELECT 1 FROM slack_decisions WHERE profile = ? AND url = ?');
  const add = db.prepare('INSERT OR IGNORE INTO slack_decisions (profile, id, text, channel, url, at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const d of list) {
    const url = webUrl(d.url);
    const text = d.text.trim();
    const name = d.channel.trim().replace(/^#/, '');
    if (!url || !text || !name || seen.get(PROFILE, url)) continue;
    add.run(PROFILE, createHash('sha1').update(`${url}\n${text.toLowerCase()}`).digest('hex').slice(0, 16), text, `#${name}`, url, Math.min(parseWhen(d.time) ?? now, now));
  }
}

export function acceptAsk(db: Database, id: string, source: 'slack' | 'gmail' = 'slack', now = Date.now()) {
  const row = db.prepare('SELECT 1 FROM items WHERE profile = ? AND id = ? AND source = ? AND deleted = 0').get(PROFILE, id, source);
  if (!row) return false;
  applyChanges(db, [{ table: 'items', id, profile: PROFILE, updated_at: now, fields: { status: 'open' } }]);
  return true;
}
