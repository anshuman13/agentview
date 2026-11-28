import { expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(import.meta.dir, '..');
const FEATURES = ['http', 'host', 'session', 'usage', 'workspace', 'agent/tools', 'index.ts'];

// Provider-neutral chat state that lives in agent/claude/ for history's sake: any feature may import these.
const NEUTRAL_MODULES = new Set(['pins', 'bin', 'seen', 'resolved', 'receipts']);
// From accounts.ts only the folder profile and the state folder are provider neutral.
const NEUTRAL_NAMES = new Set(['profileOf', 'STATE_DIR']);

function files(p: string): string[] {
  if (!statSync(p).isDirectory()) return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  return readdirSync(p).flatMap((f) => files(path.join(p, f)));
}

function claudeImports(file: string, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s+'([^']+)'/g)) {
    const target = path.resolve(path.dirname(file), m[2]);
    if (!target.includes(`${path.sep}agent${path.sep}claude${path.sep}`)) continue;
    const mod = path.basename(target).replace(/\.js$/, '');
    if (NEUTRAL_MODULES.has(mod)) continue;
    const names = [...m[1].matchAll(/(?:type\s+)?(\w+)(?:\s+as\s+\w+)?/g)].map((n) => n[1]);
    if (mod === 'accounts' && m[1].startsWith('{') && names.every((n) => NEUTRAL_NAMES.has(n))) continue;
    out.push(`${path.relative(SRC, file)}: ${m[2]}`);
  }
  return out;
}

test('the import parser flags Claude modules and lets neutral state through', () => {
  const file = path.join(SRC, 'http/x.ts');
  const text = ["import { pinned } from '../agent/claude/pins.js';", "import { profileOf, STATE_DIR } from '../agent/claude/accounts.js';", "import { loggedInAccounts } from '../agent/claude/accounts.js';", "import {\n  searchChats,\n} from '../agent/claude/search.js';"].join('\n');
  expect(claudeImports(file, text)).toEqual(['http/x.ts: ../agent/claude/accounts.js', 'http/x.ts: ../agent/claude/search.js']);
});

test.todo('feature code imports nothing provider specific from agent/claude/', () => {
  const bad = FEATURES.flatMap((f) => files(path.join(SRC, f))).flatMap((f) => claudeImports(f, readFileSync(f, 'utf8')));
  expect(bad).toEqual([]);
});
