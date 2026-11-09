import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getMeta, setMeta } from '../core/db.js';
import { run, slackConfig } from './slack.js';
import { PROFILE } from './slackSave.js';
import { applyChanges, type Change } from '../core/sync.js';

const VOICE_PAGE = 'How I write';
const META = 'draft:voice';
const MAX_TRAITS = 12;

export type Voice = { note: string; traits: string[]; examples: string[] };

// The style note the draft step adds, from the last voice run; empty when none ran yet.
export function voiceLines(db: Database): string[] {
  const raw = getMeta(db, META);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as Voice;
    const examples = v.examples.length ? ` Messages I wrote, for the tone: ${v.examples.map((e) => `"${e}"`).join(' / ')}` : '';
    return [`Write each draft the way I write: ${v.note}${examples}`];
  } catch {
    return [];
  }
}

export function voicePage(db: Database, now: number) {
  const row = db.prepare("SELECT id FROM pages WHERE profile = ? AND deleted = 0 AND lower(title) = lower(?) AND COALESCE(state, 'live') != 'rejected'").get(PROFILE, VOICE_PAGE) as { id: string } | null;
  if (row) return row.id;
  const id = crypto.randomUUID();
  applyChanges(db, [{ table: 'pages', id, profile: PROFILE, updated_at: now, fields: { title: VOICE_PAGE, section: 'Me', summary: null, sort: now, state: 'proposed' } }]);
  return id;
}

// Stores the note for the draft step and proposes each trait as a claim on the "How I write" page, once per trait text.
export function saveVoice(db: Database, v: Voice, now = Date.now()) {
  setMeta(db, META, JSON.stringify({ note: v.note.trim(), traits: v.traits, examples: v.examples.slice(0, 3) }));
  const page = voicePage(db, now);
  const changes: Change[] = [];
  for (const t of v.traits.slice(0, MAX_TRAITS)) {
    const text = t.trim();
    if (!text) continue;
    const id = `voice:${createHash('sha1').update(text.toLowerCase()).digest('hex').slice(0, 16)}`;
    if (db.prepare('SELECT 1 FROM facts WHERE profile = ? AND id = ?').get(PROFILE, id)) continue;
    changes.push({ table: 'facts', id, profile: PROFILE, updated_at: now, fields: { text, page_id: page, heading: 'Style', sources: JSON.stringify([{ kind: 'slack', label: 'my own messages' }]), at: now, state: 'proposed', replaces: null, added_by: 'voice' } });
  }
  return applyChanges(db, changes).applied;
}

// Reads my own recent Slack messages and distills how I write, for the drafts and for a wiki page to approve.
export async function learnVoice(db: Database, now = Date.now()) {
  const c = slackConfig();
  if (!c) throw new Error('Slack is not set up');
  let voice: Voice | null = null;
  const save = tool('save_voice', 'Save how I write.', {
    note: z.string().max(900).describe('One paragraph of instructions for writing a Slack reply as me: length, greeting and sign-off habits, tone, how I say no or push back, emoji and formatting, language per audience, typical phrases'),
    traits: z.array(z.string().max(200)).max(MAX_TRAITS).describe('Each trait as one specific sentence starting "I ", with an example phrase where there is one'),
    examples: z.array(z.string().max(240)).max(3).describe('Three short real messages of mine that show the tone, with names of people removed'),
  }, async (a) => {
    voice = a;
    return { content: [{ type: 'text' as const, text: 'saved' }] };
  });
  const prompt = [
    `Read about 150 of my most recent Slack messages: slack_search_public_and_private with filters "from:<@${c.me}>", sort "timestamp", include_context false, following the next cursor until you have about 150 or there are none. I am Slack user ${c.me}. Read nothing else. Do not send or change anything in Slack.`,
    'Work out how I write: typical length, whether I greet or sign off, tone, how I say no or push back, how I ask for things, emoji and formatting, which language I use with whom, phrases I reuse. Then call save_voice once. Do not use the em dash character. End with one line: how many messages you read.',
  ].join('\n');
  const result = await run(prompt, 'sonnet', [save], 30, () => voice != null);
  if (!voice) throw new Error('No voice was saved');
  return { result, traits: (voice as Voice).traits.length, proposed: saveVoice(db, voice, now) };
}
