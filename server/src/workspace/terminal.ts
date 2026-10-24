import path from 'node:path';
import { WebSocket } from 'ws';

const MAX = 200_000;
type Term = { id: string; chat: string; name: string; proc: Bun.Subprocess; buf: string; socks: Set<WebSocket> };
const terms = new Map<string, Term>();
let seq = 0;

export const listTerminals = (chat: string) => [...terms.values()].filter((t) => t.chat === chat).map(({ id, name }) => ({ id, name }));

export function createTerminal(chat: string, cwd: string) {
  const shell = process.env.SHELL || '/bin/zsh';
  const used = new Set(listTerminals(chat).map((t) => t.name));
  const label = (n: number) => (n === 1 ? path.basename(shell) : `${path.basename(shell)} ${n}`);
  let n = 1;
  while (used.has(label(n))) n++;
  const utf8 = new TextDecoder();
  const t: Term = { id: String(++seq), chat, name: label(n), proc: null!, buf: '', socks: new Set() };
  t.proc = Bun.spawn([shell, '-l'], {
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
    terminal: {
      cols: 80,
      rows: 24,
      data(_term, bytes) {
        const d = utf8.decode(bytes, { stream: true });
        t.buf += d;
        if (t.buf.length > MAX) {
          const nl = t.buf.indexOf('\n', t.buf.length - MAX);
          t.buf = t.buf.slice(nl < 0 ? t.buf.length - MAX : nl + 1);
        }
        t.socks.forEach((ws) => ws.readyState === WebSocket.OPEN && ws.send(d));
      },
    },
  });
  void t.proc.exited.then(() => {
    terms.delete(t.id);
    t.socks.forEach((ws) => ws.close());
  });
  terms.set(t.id, t);
  return { id: t.id, name: t.name };
}

export function closeTerminal(id: string) {
  terms.get(id)?.proc.kill();
  terms.delete(id);
  return { ok: true };
}

export const closeTerminals = (chat: string) => listTerminals(chat).forEach((t) => closeTerminal(t.id));

export function attachTerminal(ws: WebSocket, id: string) {
  const t = terms.get(id);
  if (!t) return ws.close();
  if (t.buf) ws.send(t.buf);
  t.socks.add(ws);
  ws.on('message', (raw) => {
    let m: { t: string; d?: string; c?: number; r?: number };
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.t === 'i' && typeof m.d === 'string') t.proc.terminal?.write(m.d);
    if (m.t === 'r') {
      const dim = (v: unknown) => Math.min(1000, Math.max(2, Math.floor(Number(v)) || 0));
      if (dim(m.c) > 2 || dim(m.r) > 2) t.proc.terminal?.resize(dim(m.c), dim(m.r));
    }
    if (m.t === 'c') t.buf = t.buf.slice(t.buf.lastIndexOf('\n') + 1);
  });
  ws.on('close', () => t.socks.delete(ws));
}
