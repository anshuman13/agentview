import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type http from 'node:http';

export const NETBIRD = ['/opt/homebrew/bin/netbird', '/usr/local/bin/netbird'].find((p) => existsSync(p)) ?? 'netbird';
const TTL = 15_000;

export type NetbirdPeer = { fqdn: string; netbirdIp?: string; netbirdIpv6?: string };
export type NetbirdStatus = {
  daemonStatus?: string;
  fqdn?: string;
  management?: { error?: string };
  netbirdIp?: string;
  netbirdIpv6?: string;
  peers?: { details?: NetbirdPeer[] | null };
};

// Only this Mac and the peers NetBird lists may connect. The list comes from `netbird status --json`, refreshed every 15s.
let status: NetbirdStatus | null = null;
let peers = new Set<string>();
let fetched = 0;
let fetching: Promise<NetbirdStatus | null> | null = null;

export function canon(addr: string) {
  const a = addr.split('%')[0].split('/')[0].replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1').replace(/^\[|\]$/g, '');
  if (!a.includes(':')) return a;
  try {
    return new URL(`http://[${a}]`).hostname.slice(1, -1);
  } catch {
    return a;
  }
}

export function loadStatus(json: string | null) {
  fetched = Date.now();
  try {
    status = json ? (JSON.parse(json) as NetbirdStatus) : null;
  } catch {
    status = null;
  }
  const all = status ? [status.netbirdIp, status.netbirdIpv6, ...(status.peers?.details ?? []).flatMap((p) => [p.netbirdIp, p.netbirdIpv6])] : [];
  peers = new Set(all.filter((x): x is string => !!x).map(canon));
  return status;
}

export function netbirdStatus(): Promise<NetbirdStatus | null> {
  if (Date.now() - fetched < TTL) return Promise.resolve(status);
  fetching ??= new Promise((resolve) =>
    execFile(NETBIRD, ['status', '--json'], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
      fetching = null;
      resolve(loadStatus(err ? null : out));
    }),
  );
  return fetching;
}

try {
  loadStatus(execFileSync(NETBIRD, ['status', '--json'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }).toString());
} catch {
  loadStatus(null);
}
setInterval(() => void netbirdStatus(), TTL).unref();

const loopback = (a: string) => a === '127.0.0.1' || a === '::1';

export const allowedPeer = (addr = '') => {
  const a = canon(addr);
  if (loopback(a) || peers.has(a)) return true;
  void netbirdStatus();
  return false;
};

const short = (fqdn?: string) => fqdn?.split('.')[0] || undefined;

// The NetBird name of the device a request comes from, such as "macmini"; loopback is this Mac.
export const peerName = (addr = '') => {
  const a = canon(addr);
  if (loopback(a) || a === status?.netbirdIp || a === status?.netbirdIpv6) return short(status?.fqdn) ?? 'local';
  const p = status?.peers?.details?.find((d) => (d.netbirdIp && canon(d.netbirdIp) === a) || (d.netbirdIpv6 && canon(d.netbirdIpv6) === a));
  return short(p?.fqdn);
};

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};

const allowedHost = (h: string) => h === 'localhost' || h.endsWith('.localhost') || loopback(canon(h)) || h.endsWith('.netbird.cloud') || peers.has(canon(h));

const sameOrigin = (origin: string, host: string) => {
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && u.host === host;
  } catch {
    return false;
  }
};

export type RequestHeaders = { host?: string; origin?: string; 'sec-fetch-site'?: string; 'sec-fetch-mode'?: string };

// The page must be served by this server (Host allowed, Origin equal to it). Browsers send no Origin on plain GETs, so
// Sec-Fetch-Site catches cross-site image and script loads; cross-site navigations into AgentView stay allowed.
export const allowedRequest = (h: RequestHeaders) => {
  const host = h.host ?? '';
  if (!/^[\w.\-:[\]]+$/.test(host) || !allowedHost(hostOf(`http://${host}`))) return false;
  if (h.origin && !sameOrigin(h.origin, host)) return false;
  const site = h['sec-fetch-site'];
  return !site || site === 'same-origin' || site === 'none' || h['sec-fetch-mode'] === 'navigate';
};

// The address a request comes from. Vite proxies from loopback and adds X-Forwarded-For, which only loopback may claim.
export function requester(req: http.IncomingMessage) {
  const sock = canon(req.socket.remoteAddress ?? '');
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return loopback(sock) && fwd ? canon(fwd) : sock;
}
