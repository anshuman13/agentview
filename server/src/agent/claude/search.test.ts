import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { searchMessages } from './search.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'agentview-search-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const line = (o: object) => JSON.stringify(o);

describe('searchMessages', () => {
  it('finds prompts and replies holding every word, newest first, skipping tool output and meta lines', async () => {
    const dir = path.join(root, 'projects', '-repo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'a.jsonl'), [
      line({ type: 'user', sessionId: 'a', timestamp: '2026-11-01T10:00:00Z', message: { content: 'Fix the Retry logic in the importer' } }),
      line({ type: 'assistant', sessionId: 'a', timestamp: '2026-11-02T10:00:00Z', message: { content: [{ type: 'text', text: 'The importer retry now waits 2 s.' }, { type: 'tool_use', name: 'Bash' }] } }),
      line({ type: 'user', sessionId: 'a', timestamp: '2026-11-03T10:00:00Z', message: { content: [{ type: 'tool_result', content: 'importer retry output' }] } }),
      line({ type: 'user', sessionId: 'a', isMeta: true, timestamp: '2026-11-04T10:00:00Z', message: { content: 'importer retry meta' } }),
      line({ type: 'user', sessionId: 'a', timestamp: '2026-11-05T10:00:00Z', message: { content: 'only the importer' } }),
    ].join('\n'));
    const hits = await searchMessages('retry importer', root);
    expect(hits.map((h) => [h.role, h.text])).toEqual([
      ['assistant', 'The importer retry now waits 2 s.'],
      ['user', 'Fix the Retry logic in the importer'],
    ]);
    expect(await searchMessages('nothing here', root)).toEqual([]);
  });
});
