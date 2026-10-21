import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';

export type Mac = { name: string; url: string; running: number };

const NETBIRD = ['/opt/homebrew/bin/netbird', '/usr/local/bin/netbird'].find((p) => existsSync(p)) ?? 'netbird';
const PEERS_TTL = 15_000;

let cached: { at: number; peers: Promise<string[]> } | undefined;

function peers() {
  if (cached && Date.now() - cached.at < PEERS_TTL) return cached.peers;
  const found = new Promise<string[]>((resolve) =>
    execFile(NETBIRD, ['status', '--json'], { timeout: 5000 }, (err, out) => {
      if (err) return resolve([]);
      try {
        const status = JSON.parse(out) as { peers?: { details?: { fqdn: string }[] } };
        resolve((status.peers?.details ?? []).map((p) => p.fqdn).filter(Boolean));
      } catch {
        resolve([]);
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

export async function otherMacs(port: string): Promise<Mac[]> {
  const probes = (await peers()).map(async (fqdn) => {
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
  return (await Promise.all(probes)).filter((m): m is Mac => m !== null);
}
