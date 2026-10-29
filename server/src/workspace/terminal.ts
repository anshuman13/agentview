import path from 'node:path';
import { WebSocket } from 'ws';
import { parseFrame } from '../http/body.js';
import { OutputBuffer } from './outputBuffer.js';

const MAX = 200_000;
type Term = { id: string; chat: string; name: string; proc: Bun.Subprocess; out: OutputBuffer; socks: Set<WebSocket> };
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
  const t: Term = { id: String(++seq), chat, name: label(n), proc: null!, out: null!, socks: new Set() };
  t.out = new OutputBuffer(MAX, 10, (d) => t.socks.forEach((ws) => ws.readyState === WebSocket.OPEN && ws.send(d)));
  t.proc = Bun.spawn([shell, '-l'], {
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
    terminal: {
      cols: 80,
      rows: 24,
      data(_term, bytes) {
        t.out.push(utf8.decode(bytes, { stream: true }));
      },
    },
  });
  void t.proc.exited.then(() => {
    t.out.dispose();
    terms.delete(t.id);
    t.socks.forEach((ws) => ws.close());
  });
  terms.set(t.id, t);
  return { id: t.id, name: t.name };
}

// An interactive shell ignores SIGTERM; SIGHUP is what a closing terminal sends, and SIGKILL follows if that fails.
export function closeTerminal(id: string) {
  const proc = terms.get(id)?.proc;
  if (proc) {
    proc.kill('SIGHUP');
    const force = setTimeout(() => proc.kill('SIGKILL'), 3_000);
    void proc.exited.then(() => clearTimeout(force));
  }
  terms.delete(id);
  return { ok: true };
}

export const closeTerminals = (chat: string) => listTerminals(chat).forEach((t) => closeTerminal(t.id));

export function attachTerminal(ws: WebSocket, id: string) {
  const t = terms.get(id);
  if (!t) return ws.close();
  const snap = t.out.snapshot();
  if (snap) ws.send(snap);
  t.socks.add(ws);
  ws.on('message', (raw) => {
    const m = parseFrame<{ t: string; d?: string; c?: number; r?: number }>(raw);
    if (!m) return;
    if (m.t === 'i' && typeof m.d === 'string') t.proc.terminal?.write(m.d);
    if (m.t === 'r') {
      const dim = (v: unknown) => Math.min(1000, Math.max(2, Math.floor(Number(v)) || 0));
      if (dim(m.c) > 2 || dim(m.r) > 2) t.proc.terminal?.resize(dim(m.c), dim(m.r));
    }
    if (m.t === 'c') t.out.clearLine();
  });
  ws.on('close', () => t.socks.delete(ws));
}
