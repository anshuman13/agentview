import os from 'node:os';
import path from 'node:path';
import { open, readFile, stat } from 'node:fs/promises';
import { linkOlder, SUB_GAP_MS, type ScanRun, type ScanSession, type SubLinks } from '../../../../shared/subChats.js';
import { readJson } from '../../json.js';
import { linkSubChats, listLinks } from '../../session/subChats.js';
import { projectDir } from './history.js';
import { provider } from '../registry.js';

export type Head = { account: string; startAt?: number; clearAt?: number; branch?: string; done: boolean };

// The account (session-owner), the first entry's time and, when the first prompt is /clear, its time and branch.
// done: the first prompt was seen.
export function headInfo(head: string): Head {
  let account = '';
  let startAt: number | undefined;
  for (const line of head.split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'session-owner') account = e.accountUuid ?? '';
    startAt ??= Date.parse(e.timestamp) || undefined;
    if (e.type !== 'user' || e.isMeta) continue;
    const content = e.message?.content;
    const text = typeof content === 'string' ? content : '';
    if (!text.includes('<command-name>/clear</command-name>')) return { account, startAt, done: true };
    return { account, startAt, clearAt: Date.parse(e.timestamp) || undefined, branch: e.gitBranch || undefined, done: true };
  }
  return { account, startAt, done: false };
}

type Listed = { sessionId: string; cwd?: string; gitBranch?: string | null; lastModified: number };

// The scan input from the listing; a /clear session takes the branch it was on when the /clear ran.
export function scanInput(list: Listed[], heads: Map<string, Head>): ScanSession[] {
  return list.filter((x) => x.cwd).map((x) => {
    const h = heads.get(x.sessionId);
    return { sessionId: x.sessionId, cwd: x.cwd!, branch: h?.branch ?? x.gitBranch ?? null, account: h?.account ?? '', lastAt: x.lastModified, ...(h?.clearAt && { clearAt: h.clearAt }) };
  });
}

// When the chat queued each /clear, from the queue entries Claude writes to the old transcript.
export function sentClears(text: string) {
  return text.split('\n').flatMap((l) => {
    if (!l.includes('"enqueue"') || !l.includes('/clear')) return [];
    try {
      const e = JSON.parse(l);
      return e.type === 'queue-operation' && e.operation === 'enqueue' && e.content?.trim() === '/clear' && Date.parse(e.timestamp) ? [Date.parse(e.timestamp)] : [];
    } catch {
      return [];
    }
  });
}

const fileOf = (cwd: string, sessionId: string) => path.join(projectDir(cwd), `${sessionId}.jsonl`);
const HEAD = 64 * 1024;

async function readHead(cwd: string, sessionId: string) {
  const file = await open(fileOf(cwd, sessionId)).catch(() => null);
  if (!file) return '';
  try {
    const buf = Buffer.alloc(HEAD);
    const { bytesRead } = await file.read(buf, 0, HEAD, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
}

// Sessions that could have sent an unlinked /clear: same cwd, begun before it and active up to 2 minutes before it or later.
export function maybeParents(input: ScanSession[], links: SubLinks, heads: Map<string, Head>) {
  const clears = input.filter((c) => c.clearAt && !links[c.sessionId]);
  return input.filter((s) => clears.some((c) => c !== s && c.cwd === s.cwd && (heads.get(s.sessionId)?.startAt ?? 0) <= c.clearAt! && s.lastAt >= c.clearAt! - SUB_GAP_MS));
}

// The /clear a session queued that matches an unlinked /clear in its cwd.
export const matchSent = (times: number[], s: ScanSession, input: ScanSession[]) =>
  times.find((t) => input.some((c) => c.clearAt && c.cwd === s.cwd && Math.abs(c.clearAt - t) <= 5000));

const heads = new Map<string, Head>();
const sent = new Map<string, { size: number; times: number[] }>();

async function sentOf(s: ScanSession) {
  const file = fileOf(s.cwd, s.sessionId);
  const size = await stat(file).then((x) => x.size, () => 0);
  const hit = sent.get(s.sessionId);
  if (hit?.size === size) return hit.times;
  const times = sentClears(await readFile(file, 'utf8').catch(() => ''));
  sent.set(s.sessionId, { size, times });
  return times;
}
const RUNS = path.join(os.homedir(), '.agentview', 'runs.json');

export async function scanPass(list: Listed[]) {
  await Promise.all(list.filter((x) => x.cwd && !heads.has(x.sessionId)).map(async (x) => {
    const h = headInfo(await readHead(x.cwd!, x.sessionId));
    if (h.done) heads.set(x.sessionId, h);
  }));
  const [links, runs] = await Promise.all([listLinks(), readJson<ScanRun[]>(RUNS, [])]);
  const input = scanInput(list, heads);
  await Promise.all(maybeParents(input, links, heads).map(async (s) => {
    s.clearedAt = matchSent(await sentOf(s), s, input);
  }));
  const found = linkOlder(input, links, Array.isArray(runs) ? runs : []);
  const add = Object.entries(found).map(([child, l]) => ({ child, ...l }));
  if (add.length) await linkSubChats(add);
  return add.length;
}

// Once after start, then whenever the session listing changes.
export function startSubChatScan() {
  let last = '';
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      // Only Claude chats start sub-chats with /clear.
      const list = await provider('claude').transcripts.list();
      const key = list.map((x) => `${x.sessionId}:${x.lastModified}`).join();
      if (key === last) return;
      last = key;
      await scanPass(list);
    } catch (e) {
      console.error('sub-chat scan failed:', e);
    } finally {
      running = false;
    }
  };
  setTimeout(pass, 5_000).unref();
  setInterval(pass, 60_000).unref();
}
