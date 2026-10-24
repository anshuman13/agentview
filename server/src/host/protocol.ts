import os from 'node:os';
import path from 'node:path';
import type { Socket } from 'node:net';
import type { ClientMessage, LiveChat, ServerMessage } from '../../../shared/protocol.js';

// The agent host owns the chats and their Claude processes; the API server talks to it over this socket,
// so the API server can restart without ending a turn.
export const socketPath = (port: number | string) => path.join(os.homedir(), '.agentview', `host-${port}.sock`);

export type HostRequest =
  | { op: 'hello' }
  | { op: 'state'; id: string }
  | { op: 'cmd'; id: string; msg: ClientMessage }
  | { op: 'open'; sessionId: string }
  | { op: 'new'; cwd: string; from: string; fork?: string }
  | { op: 'close'; id: string }
  | { op: 'ask'; cwd: string; prompt: string; from?: string; fresh?: boolean }
  | { op: 'mcp_add'; id: string; name: string }
  | { op: 'mcp_login'; id: string; name: string }
  | { op: 'viewers'; counts: Record<string, number>; last: string }
  | { op: 'restart'; now: boolean; force: boolean };

export type Hello = { last: string; restarting: boolean; chats: LiveChat[] };

// Host to API: replies carry the request number; everything else is a broadcast, to one chat's viewers or to all.
export type HostLine = { n: number; ok: true; r: unknown } | { n: number; ok: false; error: string } | { chat: string | null; m: ServerMessage } | { closed: string };

// Newline-delimited JSON. Lines are handled synchronously in order, so a reply and the broadcasts after it keep their order.
export function lines(sock: Socket, on: (v: unknown) => void) {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        on(JSON.parse(line));
      } catch (err) {
        console.error('host line:', err);
      }
    }
  });
  return (v: unknown) => sock.writable && sock.write(`${JSON.stringify(v)}\n`);
}
