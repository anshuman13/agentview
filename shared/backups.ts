export type BackupFile = { name: string; size: number; mtime: number };

export const BACKUP_NAME = /^(assistant-\d{4}-\d\d-\d\d\.db|(?:travel|state)-\d{4}-\d\d-\d\d\.tgz)$/;

// The mini's backups this Mac lacks or holds an older copy of.
export const toPull = (remote: BackupFile[], local: BackupFile[]) => {
  const have = new Map(local.map((f) => [f.name, f]));
  return remote.filter((f) => {
    const mine = have.get(f.name);
    return BACKUP_NAME.test(f.name) && !(mine && mine.size === f.size && mine.mtime >= f.mtime);
  });
};
