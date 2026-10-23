import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { canon, netbirdStatus, type NetbirdStatus } from './access.js';

export type Mac = { name: string; url: string; running: number; self: boolean };

const MACS_TTL = 5_000;

export function netbirdProblem(d: NetbirdStatus) {
  if (d.daemonStatus === 'Connected') return undefined;
  if (/login has expired/i.test(d.management?.error ?? '')) return 'NetBird login on this Mac has expired. Run netbird up to sign in again.';
  if (d.daemonStatus === 'NeedsLogin') return 'NetBird on this Mac is not signed in. Run netbird up.';
  return `NetBird on this Mac is ${d.daemonStatus ?? 'not connected'}.`;
}

export const macName = (hostname: string) => hostname.replace(/\.local$/, '');

export const thisMac = (() => {
  try {
    return execFileSync('scutil', ['--get', 'LocalHostName'], { timeout: 2000 }).toString().trim() || macName(os.hostname());
  } catch {
    return macName(os.hostname());
  }
})();

type Found = { name: string; url: string; running: number; ips: string[] };

async function probe(fqdn: string, ips: string[], port: string): Promise<Found | null> {
  if (!/^[a-z0-9.-]+$/i.test(fqdn)) return null;
  const url = `http://${fqdn}:${port}`;
  try {
    const res = await fetch(`${url}/api/connect?peer=1`, { redirect: 'error', signal: AbortSignal.timeout(6000) });
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > 4096) return null;
    const d = (await res.json()) as { hostname?: unknown; running?: unknown };
    if (typeof d.hostname !== 'string' || !d.hostname || d.hostname.length > 64) return null;
    return { name: macName(d.hostname), url, running: typeof d.running === 'number' ? d.running : 0, ips };
  } catch {
    return null;
  }
}

let cached: { at: number; port: string; found: Promise<Found[]> } | undefined;

function findMacs(port: string) {
  if (cached && cached.port === port && Date.now() - cached.at < MACS_TTL) return cached.found;
  const found = netbirdStatus().then((s) =>
    Promise.all((s?.peers?.details ?? []).map((p) => probe(p.fqdn, [p.netbirdIp, p.netbirdIpv6].filter((x): x is string => !!x).map(canon), port))).then((all) => all.filter((m): m is Found => m !== null)),
  );
  cached = { at: Date.now(), port, found };
  return found;
}

// `from` is the address the browser connects from; the peer it belongs to is the Mac the user sits at.
export async function otherMacs(port: string, from: string): Promise<{ macs: Mac[]; problem?: string }> {
  const [found, status] = await Promise.all([findMacs(port), netbirdStatus()]);
  const macs = found.map(({ ips, ...m }) => ({ ...m, self: ips.includes(from) }));
  return { macs, problem: status ? netbirdProblem(status) : 'NetBird is not running on this Mac.' };
}
