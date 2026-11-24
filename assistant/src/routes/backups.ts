import { readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BACKUP_NAME } from '../../../shared/backups.js';
import { send, type Routes } from './http.js';

const DIR = path.join(process.env.ASSISTANT_DIR ?? path.join(os.homedir(), '.agentview/assistant'), 'backups');

export const backupFiles = (dir = DIR) =>
  readdirSync(dir).filter((n) => BACKUP_NAME.test(n)).map((name) => {
    const st = statSync(path.join(dir, name));
    return { name, size: st.size, mtime: st.mtimeMs };
  });

// Other Macs copy the nightly backups from here.
export const backupRoutes: Routes = {
  'GET /backups': ({ res }) => send(res, 200, { files: backupFiles() }),
  'GET /backups/file': ({ res, url }) => {
    const name = url.searchParams.get('name') ?? '';
    if (!BACKUP_NAME.test(name)) send(res, 404, { error: 'No such backup' });
    else res.file(Bun.file(path.join(DIR, name)));
  },
};
