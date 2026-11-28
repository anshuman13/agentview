import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';

const root = mkdtempSync(path.join(os.tmpdir(), 'agentview-strategy-'));
process.env.CLAUDE_CONFIG_DIR = root;
afterAll(() => rmSync(root, { recursive: true, force: true }));

const { claudeStrategy } = await import('./strategy.js');

const id = 'b7e2c0de-0000-4000-8000-strategytest';
const line = (o: object) => JSON.stringify(o);

describe('claude transcripts', () => {
  it('finds, tails, searches and reads the first commit of a saved chat', async () => {
    const dir = path.join(root, 'projects', '-repo');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.jsonl`);
    writeFileSync(file, [
      line({ type: 'user', sessionId: id, cwd: '/repo', timestamp: '2026-11-01T10:00:00Z', message: { content: 'Add the zebra importer' } }),
      line({ type: 'assistant', sessionId: id, cwd: '/repo', timestamp: '2026-11-01T10:01:00Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git commit -m "Add the store"' } }] } }),
      line({ type: 'user', sessionId: id, cwd: '/repo', timestamp: '2026-11-01T10:02:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '[main a1b2c3d] Add the store\n 1 file changed' }] } }),
    ].join('\n'));
    const t = claudeStrategy().transcripts;
    expect(t.path(id)).toBe(file);
    expect(t.path('missing')).toBeNull();
    expect(await t.tail(id)).toContain('zebra importer');
    expect(await t.tail('missing')).toBe('');
    expect((await t.search(['zebra'], 10)).map((h) => [h.sessionId, h.text])).toEqual([[id, 'Add the zebra importer']]);
    expect(await t.firstCommit(id)).toEqual({ hash: 'a1b2c3d', subject: 'Add the store' });
  });
});
