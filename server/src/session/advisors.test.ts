import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ADVISORS, advisorOf } from '../../../shared/advisors.js';
import { prepareAdvisor } from './advisors.js';

describe('prepareAdvisor', () => {
  it('writes the role with the memory import and keeps an existing memory', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'advisors-'));
    const dir = await prepareAdvisor(ADVISORS[0], ['/w/a', '/w/b'], home);
    const claude = await readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude.startsWith('# PM')).toBe(true);
    expect(claude).toContain('/w/a and /w/b');
    expect(claude.trimEnd().endsWith('@memory.md')).toBe(true);
    expect(JSON.parse(await readFile(path.join(dir, '.claude/settings.json'), 'utf8'))).toEqual({ permissions: { additionalDirectories: ['/w/a', '/w/b'] } });
    await writeFile(path.join(dir, 'memory.md'), '# PM memory\n- AgentView: ship the sketch step first\n');
    await prepareAdvisor(ADVISORS[0], ['/w/a', '/w/b'], home);
    expect(await readFile(path.join(dir, 'memory.md'), 'utf8')).toContain('sketch step');
  });

  it('matches advisor folders only', () => {
    expect(advisorOf('/Users/x/.agentview/advisors/architect')?.name).toBe('Architect');
    expect(advisorOf('/Users/x/.agentview/advisors/pm/')?.id).toBe('pm');
    expect(advisorOf('/Users/x/workspace/pm')).toBeUndefined();
  });
});
