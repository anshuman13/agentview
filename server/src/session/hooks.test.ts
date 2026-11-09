import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { claudeSession } from '../agent/claude/driver.js';
import { globMatch, Hooks, parseHooks } from './hooks.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'hooks-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const config = {
  project: [
    { name: 'lint', on: 'save', glob: 'src/**/*.ts', prompt: 'Lint it' },
    { name: 'tests', on: 'stop', prompt: 'Run tests' },
    { name: 'docs', on: 'manual', prompt: 'Update docs' },
    { name: 'bad', on: 'sometimes', prompt: 'x' },
  ],
};

async function loaded(file = 'hooks.json') {
  writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify(config));
  const s = claudeSession('/tmp/project');
  const send = vi.spyOn(s.driver, 'send');
  Object.assign(s, { hooks: new Hooks(s, path.join(dir, file)) });
  await s.hooks.load();
  const handle = (s.driver as unknown as { handle: (m: unknown) => void }).handle.bind(s.driver);
  const result = (uuid: string) => handle({ type: 'result', subtype: 'success', uuid, result: 'done', total_cost_usd: 0 });
  return { s, send, result };
}

describe('hooks', () => {
  it('matches globs, and skips invalid entries with one log line each', () => {
    expect(globMatch('src/**/*.ts', 'src/a/b.ts')).toBe(true);
    expect(globMatch('src/**/*.ts', 'src/b.ts')).toBe(true);
    expect(globMatch('*.ts', 'src/b.ts')).toBe(false);
    const bad = vi.fn();
    expect(parseHooks(config, 'project', bad).map((h) => h.name)).toEqual(['lint', 'tests', 'docs']);
    expect(bad).toHaveBeenCalledOnce();
  });

  it('fires nothing without a file or an entry for the repo', async () => {
    const { s, send } = await loaded('missing.json');
    s.hooks.saved('src/a.ts');
    s.hooks.run('docs');
    expect(send).not.toHaveBeenCalled();
    expect(s.state.session.hooks).toEqual([]);
  });

  it('runs a save hook at most once per 30 seconds and only for matching paths', async () => {
    const { s, send, result } = await loaded();
    expect(s.state.session.hooks).toEqual(['docs']);
    s.hooks.saved('README.md');
    expect(send).not.toHaveBeenCalled();
    s.hooks.saved('src/a.ts', 1000);
    expect(send.mock.calls[0][0]).toBe('Hook: lint\n\nLint it\n\nChanged file: src/a.ts');
    result('r1');
    s.hooks.saved('src/b.ts', 20_000);
    expect(send).toHaveBeenCalledTimes(1);
    s.hooks.saved('src/b.ts', 31_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('runs the stop hooks after a turn that changed files, and not after a hook turn', async () => {
    const { s, send, result } = await loaded();
    s.sendPrompt('look');
    send.mockClear();
    result('r1');
    expect(send).not.toHaveBeenCalled();
    s.sendPrompt('edit');
    s.noteFile('a.ts', 'tool');
    send.mockClear();
    result('r2');
    expect(send.mock.calls[0][0]).toBe('Hook: tests\n\nRun tests');
    s.noteFile('a.ts', 'tool');
    result('r3');
    expect(send).toHaveBeenCalledTimes(1);
    expect(s.state.session.running).toBe(false);
  });

  it('holds off while a question is pending', async () => {
    const { s, send } = await loaded();
    s.state.pending.push({ id: 'p' } as never);
    s.hooks.saved('src/a.ts');
    s.hooks.run('docs');
    expect(send).not.toHaveBeenCalled();
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system' });
  });
});
