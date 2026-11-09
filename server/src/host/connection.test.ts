import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { expect, test } from 'vitest';
import { connection } from './connection.js';
import { lines } from './protocol.js';
import { apis } from './state.js';

const ask = (sock: string, req: object) =>
  new Promise<void>((ok) => {
    const c = net.connect(sock);
    const send = lines(c, () => ok());
    c.on('connect', () => send({ n: 1, ...req }));
    c.on('close', () => ok());
  });

test('only a connection that says hello joins the broadcasts', async () => {
  const sock = path.join(mkdtempSync(path.join(os.tmpdir(), 'av-')), 'host.sock');
  const server = net.createServer(connection(async () => null));
  await new Promise<void>((ok) => server.listen(sock, ok));
  try {
    await ask(sock, { op: 'tool_call', id: 'c', name: 'set_status', args: {} });
    expect(apis.size).toBe(0);
    await ask(sock, { op: 'hello' });
    expect(apis.size).toBe(1);
  } finally {
    server.close();
  }
});
