import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { statSync, readFileSync } from 'node:fs';
import { DB_DIR } from './db.js';


let cachedDevices: Map<string, string> | null = null;
let cachedMtime: number | null = null;
let cachedFile: string = '';

export function loadDevices(file = path.join(DB_DIR, 'devices.json')): Map<string, string> {
  const result = new Map<string, string>();
  try {
    const content = readFileSync(file, 'utf-8');
    const data = JSON.parse(content) as Record<string, string>;
    for (const [deviceName, key] of Object.entries(data)) {
      result.set(key, deviceName);
    }
  } catch {}
  return result;
}

export function deviceFor(key: string | undefined): string | undefined {
  const file = path.join(DB_DIR, 'devices.json');

  let mtime: number | null = null;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {}

  if (file !== cachedFile || mtime !== cachedMtime) {
    cachedDevices = loadDevices(file);
    cachedMtime = mtime;
    cachedFile = file;
  }

  if (!key || !cachedDevices) return undefined;

  const cachedKey = Array.from(cachedDevices.keys()).find((k) => {
    try {
      const hashedKey = createHash('sha256').update(key).digest();
      const hashedCachedKey = createHash('sha256').update(k).digest();
      return hashedKey.length === hashedCachedKey.length &&
             timingSafeEqual(hashedKey, hashedCachedKey);
    } catch {
      return false;
    }
  });

  return cachedKey ? cachedDevices.get(cachedKey) : undefined;
}
