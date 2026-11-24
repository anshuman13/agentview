import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BACKUP_NAME, toPull, type BackupFile } from '../../../shared/backups.js';
import { errText } from '../../../shared/util.js';
import { HUB } from './assistant.js';

const DIR = path.join(os.homedir(), '.agentview/mini-backups');
const KEEP_MS = 14 * 86_400_000;

const localFiles = (): BackupFile[] =>
  readdirSync(DIR).filter((n) => BACKUP_NAME.test(n)).map((name) => {
    const st = statSync(path.join(DIR, name));
    return { name, size: st.size, mtime: st.mtimeMs };
  });

// Copies the hub Mac's new backups here and drops copies older than 14 days.
export async function pullBackups() {
  mkdirSync(DIR, { recursive: true });
  const r = await fetch(`${HUB}/backups`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`backups list: ${r.status}`);
  const { files } = (await r.json()) as { files: BackupFile[] };
  for (const f of toPull(files, localFiles())) {
    const got = await fetch(`${HUB}/backups/file?name=${encodeURIComponent(f.name)}`, { signal: AbortSignal.timeout(300_000) });
    if (!got.ok) throw new Error(`${f.name}: ${got.status}`);
    const tmp = path.join(DIR, `${f.name}.tmp`);
    await Bun.write(tmp, got);
    utimesSync(tmp, new Date(), new Date(f.mtime));
    renameSync(tmp, path.join(DIR, f.name));
  }
  for (const f of localFiles()) if (Date.now() - f.mtime > KEEP_MS) unlinkSync(path.join(DIR, f.name));
}

// On a Mac without the hub: try every hour, so a laptop that was asleep catches up when it wakes.
export function startBackupPull() {
  if (new URL(HUB).hostname === 'localhost') return;
  const run = () => pullBackups().catch((err) => console.error('backup pull:', errText(err)));
  setTimeout(run, 60_000);
  setInterval(run, 3_600_000);
}
