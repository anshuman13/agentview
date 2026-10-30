import type { Database } from 'bun:sqlite';
import { errText } from '../../../shared/util.js';
import { gmailScan } from '../gmail.js';
import type { Counts } from '../scan.js';
import { slackScan } from '../slack.js';
import { send, type Routes } from './http.js';

type Scanner = { setUp(): boolean; paused(db: Database): Promise<boolean>; run(db: Database): Promise<Counts> };

export const SCANNERS: Record<string, Scanner> = { slack: slackScan, gmail: gmailScan };

// Runs one scan now, outside its slots; a scan already running is joined, not doubled.
export function scanRoutes(scanners = SCANNERS): Routes {
  return {
    'POST /scan': async ({ res, url, getDb }) => {
      const name = url.searchParams.get('name') ?? '';
      const s = Object.hasOwn(scanners, name) ? scanners[name] : null;
      if (!s) return send(res, 400, { error: 'Unknown scan' });
      if (!s.setUp()) return send(res, 409, { error: `${name} is not set up` });
      if (await s.paused(getDb())) return send(res, 409, { error: `${name} scans are paused at the Claude usage limit` });
      try {
        send(res, 200, { counts: await s.run(getDb()) });
      } catch (err) {
        send(res, 502, { error: errText(err) });
      }
    },
  };
}
