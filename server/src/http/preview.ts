import net from 'node:net';
import { allowedPeer, canon, netbirdIp } from './access.js';
import { exec, type ExecError } from '../exec.js';

export type DevPort = { port: number; name: string; local: boolean };

const DEV = /^(node|bun|deno|python[\d.]*|ruby|php|uvicorn|gunicorn|rails|hugo|caddy|nginx)$/i;
const OWN = new Set([7777, 7779, 7790, 7791]);

// Parses `lsof -F cn` into the dev servers listening on this Mac. local marks a port bound to loopback only.
export function parsePorts(out: string): DevPort[] {
  const seen = new Map<number, DevPort>();
  let name = '';
  for (const line of out.split('\n')) {
    if (line[0] === 'c') name = line.slice(1);
    if (line[0] !== 'n' || !DEV.test(name)) continue;
    const m = line.match(/^n(.*):(\d+)$/);
    if (!m) continue;
    const port = Number(m[2]);
    if (OWN.has(port) || port < 1024 || port >= 49152) continue;
    const local = ['127.0.0.1', '[::1]', 'localhost'].includes(m[1]);
    const prev = seen.get(port);
    seen.set(port, { port, name, local: (prev?.local ?? true) && local });
  }
  return [...seen.values()].sort((a, b) => a.port - b.port);
}

export const listPorts = () =>
  exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'cn'], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }).then(
    (r) => parsePorts(r.stdout),
    (err: ExecError) => parsePorts(err.stdout ?? ''),
  );

const forwards = new Map<number, net.Server>();

// A dev server bound to loopback gets a twin on the NetBird address, open to NetBird peers only.
function forward(ip: string, port: number) {
  if (forwards.has(port)) return;
  const server = net.createServer((sock) => {
    if (!allowedPeer(sock.remoteAddress)) return sock.destroy();
    const up = net.connect(port, '127.0.0.1');
    sock.pipe(up).pipe(sock);
    const close = () => (sock.destroy(), up.destroy());
    sock.on('error', close);
    up.on('error', close);
  });
  server.on('error', () => forwards.delete(port));
  server.listen(port, ip);
  forwards.set(port, server);
}

// The URL the requesting device opens for a dev server on this Mac.
export async function openPort(port: number, host = 'localhost') {
  const p = (await listPorts()).find((x) => x.port === port);
  if (!p) return { status: 404, body: { error: 'nothing listens on that port' } };
  const hostname = new URL(`http://${host}`).hostname;
  const ip = netbirdIp();
  const loop = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (p.local && !loop) {
    if (!ip) return { status: 503, body: { error: 'NetBird is down' } };
    forward(ip, port);
    return { url: `http://${ip.includes(':') ? `[${canon(ip)}]` : ip}:${port}/` };
  }
  return { url: `http://${hostname}:${port}/` };
}
