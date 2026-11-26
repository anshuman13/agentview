import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Account } from '../../../shared/protocol.js';
import { errText } from '../../../shared/util.js';
import { chatAccount, profileOf } from '../agent/claude/accounts.js';
import { CLAUDE_DIR } from '../agent/claude/history.js';
import { type CallMessage, callRow } from './calls.js';
import { type CallRow, getMeta, saveCalls, setMeta } from './store.js';

type Line = { type?: string; sessionId?: string; timestamp?: string; cwd?: string; message?: CallMessage };

async function fileRows(file: string) {
  const rows: CallRow[] = [];
  for await (const text of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (!text.includes('"usage"')) continue;
    let l: Line;
    try {
      l = JSON.parse(text);
    } catch {
      continue;
    }
    if (l.type !== 'assistant' || !l.message?.usage || !l.sessionId) continue;
    const at = Date.parse(l.timestamp ?? '');
    if (!at) continue;
    const known = chatAccount(l.sessionId);
    const account: Account = known ?? (l.cwd && profileOf(l.cwd) === 'personal' ? 'main' : 'alt');
    const row = callRow(account, l.sessionId, l.message, at, !known);
    if (row) rows.push(row);
  }
  return rows;
}

// Reads every transcript once, one file at a time; message ids already stored are skipped.
export async function backfill(root = path.join(CLAUDE_DIR, 'projects')) {
  const files = (await readdir(root, { recursive: true }).catch(() => [] as string[])).filter((f) => f.endsWith('.jsonl')).sort();
  let added = 0;
  for (const f of files) {
    try {
      added += saveCalls(await fileRows(path.join(root, f)));
    } catch (err) {
      console.error(`usage backfill ${f}:`, errText(err));
    }
    await new Promise((r) => setImmediate(r));
  }
  setMeta('backfilled_at', String(Date.now()));
  return added;
}

export function backfillOnce() {
  if (getMeta('backfilled_at')) return;
  backfill().then(
    (n) => console.log(`usage backfill stored ${n} calls`),
    (err) => console.error('usage backfill:', errText(err)),
  );
}
