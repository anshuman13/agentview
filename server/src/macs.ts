import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';

export type Mac = { name: string; url: string; running: number };

const NETBIRD = ['/opt/homebrew/bin/netbird', '/usr/local/bin/netbird'].find((p) => existsSync(p)) ?? 'netbird';
const PEERS_TTL = 15_000;

type Peers = { hosts: string[]; problem?: string };
type Status = { daemonStatus?: string; management?: { error?: string }; peers?: { details?: { fqdn: string }[] | null } };

let cached: { at: number; peers: Promise<Peers> } | undefined;

export function netbirdProblem(d: Status) {
  if (d.daemonStatus === 'Connected') return undefined;
  if (/login has expired/i.test(d.management?.error ?? '')) return 'NetBird login on this Mac has expired. Run netbird up to sign in again.';
  if (d.daemonStatus === 'NeedsLogin') return 'NetBird on this Mac is not signed in. Run netbird up.';
  return `NetBird on this Mac is ${d.daemonStatus ?? 'not connected'}.`;
}

function peers() {
  if (cached && Date.now() - cached.at < PEERS_TTL) return cached.peers;
  const found = new Promise<Peers>((resolve) =>
    execFile(NETBIRD, ['status', '--json'], { timeout: 5000 }, (err, out) => {
      if (err) return resolve({ hosts: [], problem: 'NetBird is not running on this Mac.' });
      try {
        const status = JSON.parse(out) as Status;
        resolve({ hosts: (status.peers?.details ?? []).map((p) => p.fqdn).filter(Boolean), problem: netbirdProblem(status) });
      } catch {
        resolve({ hosts: [], problem: 'Could not read the NetBird status.' });
      }
    }),
  );
  cached = { at: Date.now(), peers: found };
  return found;
}

export const macName = (hostname: string) => hostname.replace(/\.local$/, '');

export const thisMac = (() => {
  try {
    return execFileSync('scutil', ['--get', 'LocalHostName'], { timeout: 2000 }).toString().trim() || macName(os.hostname());
  } catch {
    return macName(os.hostname());
  }
})();

export async function otherMacs(port: string): Promise<{ macs: Mac[]; problem?: string }> {
  const { hosts, problem } = await peers();
  const probes = hosts.map(async (fqdn) => {
    const url = `http://${fqdn}:${port}`;
    try {
      const res = await fetch(`${url}/api/connect?peer=1`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return null;
      const d = (await res.json()) as { hostname: string; running: number };
      return { name: macName(d.hostname), url, running: d.running ?? 0 };
    } catch {
      return null;
    }
  });
  return { macs: (await Promise.all(probes)).filter((m): m is Mac => m !== null), problem };
}
