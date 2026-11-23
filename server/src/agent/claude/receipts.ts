import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { configDir, freshAccount, stopOnOverage } from './accounts.js';
import { parseReceipt, parseTrips, RECEIPT_PROMPT, TRIPS_PROMPT, type ReceiptFields } from '../../../../shared/travel.js';

const TIMEOUT = 90_000;
const IMAGES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export const readable = (mime: string) => IMAGES.has(mime) || mime === 'application/pdf';

// Claude reads one receipt file (an image or a PDF) on the work account and returns what it found.
export async function readReceipt(file: string, mime: string): Promise<ReceiptFields> {
  const data = (await readFile(file)).toString('base64');
  const block = mime === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mime as 'image/jpeg', data } };
  return parseReceipt(await askOnce([block, { type: 'text', text: RECEIPT_PROMPT }], 'haiku'));
}

// Finds the trips in calendar event lines; empty when Claude did not answer.
export const findTrips = async (events: string) => parseTrips(await askOnce([{ type: 'text', text: `${TRIPS_PROMPT}\n\n${events}` }], 'sonnet'), () => randomUUID().slice(0, 8));

// One answer from the model on the work account with no tools; empty text when it failed.
async function askOnce(content: SDKUserMessage['message']['content'], model: 'haiku' | 'sonnet'): Promise<string> {
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', parent_tool_use_id: null, session_id: '', message: { role: 'user', content } };
  }
  const account = freshAccount(path.join(os.homedir(), 'workspace'));
  const dir = configDir(account);
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TIMEOUT);
  try {
    const q = query({ prompt: prompt(), options: { model, persistSession: false, settingSources: [], maxTurns: 1, tools: [], thinking: { type: 'disabled' }, abortController, env: { ...process.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) } } });
    for await (const m of q) {
      stopOnOverage(account, m);
      if (m.type === 'result') return m.subtype === 'success' ? m.result : '';
    }
    return '';
  } finally {
    clearTimeout(timer);
  }
}
