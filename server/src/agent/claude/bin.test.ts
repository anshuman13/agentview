import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { BIN_MS } from '../../../../shared/protocol.js';
import { stubEnv, unstubAllEnvs } from '../../../../testing.js';

let home: string;
let cwd: string;
let bin: typeof import('./bin.js');
let sessions: typeof import('./sessions.js');
const ID = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';

const transcript = (id: string, daysOld = 0) => {
  const dir = path.join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify({ type: 'user', uuid: id, sessionId: id, cwd, message: { role: 'user', content: 'first prompt' }, timestamp: new Date().toISOString() })}\n`);
  const t = new Date(Date.now() - daysOld * 86_400_000);
  fs.utimesSync(file, t, t);
};

beforeAll(async () => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bin-')));
  cwd = path.join(home, 'repo');
  fs.mkdirSync(cwd);
  stubEnv('HOME', home);
  stubEnv('CLAUDE_CONFIG_DIR', path.join(home, '.claude'));
  transcript(ID);
  transcript(OLD, 3);
  bin = await import('./bin.js');
  sessions = await import('./sessions.js');
});

afterAll(() => {
  unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('renameRoute', () => {
  it('rejects a missing id or an empty title and an unknown session', async () => {
    expect((await sessions.renameRoute(null, 'x')).status).toBe(400);
    expect((await sessions.renameRoute(ID, '  ')).status).toBe(400);
    expect((await sessions.renameRoute(ID, 5)).status).toBe(400);
    expect((await sessions.renameRoute('33333333-3333-4333-8333-333333333333', 'x')).status).toBe(404);
  });

  it('lists the latest title after two renames', async () => {
    expect((await sessions.renameRoute(ID, 'First')).status).toBe(200);
    expect((await sessions.renameRoute(ID, 'Second')).status).toBe(200);
    const list = await sessions.listSessions();
    expect(list.find((s) => s.sessionId === ID)?.summary).toBe('Second');
  });
});

describe('removeSession', () => {
  it('moves a chat older than the bin window to the bin when archiving', async () => {
    expect(Date.now() - (await sessions.getSessionInfo(OLD, { dir: cwd }))!.lastModified).toBeGreaterThan(BIN_MS);
    expect(await bin.removeSession(OLD, false, true)).toEqual({ purged: false });
    expect((await bin.listBin()).map((b) => b.sessionId)).toContain(OLD);
  });

  it('deletes a chat older than the bin window without archive', async () => {
    transcript(OLD, 3);
    expect(await bin.removeSession(OLD, false)).toEqual({ purged: true });
    expect(await sessions.getSessionInfo(OLD, { dir: cwd })).toBeUndefined();
  });
});
