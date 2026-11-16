import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A fingerprint of the wire protocol: protocol.ts without its comment lines, so editing a comment keeps it.
export function protocolHash() {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/protocol.ts');
  const code = readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  return createHash('sha1').update(code).digest('hex').slice(0, 12);
}
