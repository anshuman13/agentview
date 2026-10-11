import { describe, expect, it } from 'vitest';
import { buildTurns } from './Summary';
import type { ChatEvent } from '../../../shared/protocol';

const ev = (e: Record<string, unknown>) => ({ id: String(Math.random()), at: 1, ...e }) as ChatEvent;

describe('buildTurns', () => {
  it('collects edits, commands and per-turn cost', () => {
    const { turns, totalCost } = buildTurns(
      [
        ev({ kind: 'user', text: 'one' }),
        ev({ kind: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/a.ts' }, summary: '' }),
        ev({ kind: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/a.ts' }, summary: '' }),
        ev({ kind: 'tool_use', name: 'Bash', input: { command: 'npm test' }, summary: '' }),
        ev({ kind: 'result', text: 'ok', costUsd: 0.1, isError: false }),
        ev({ kind: 'user', text: 'two' }),
        ev({ kind: 'tool_use', name: 'Write', input: { file_path: '/elsewhere/b.md' }, summary: '' }),
        ev({ kind: 'result', text: 'ok', costUsd: 0.25, isError: false }),
      ],
      '/repo',
    );
    expect(turns.map((t) => t.edits)).toEqual([['src/a.ts'], ['/elsewhere/b.md']]);
    expect(turns[0].commands).toEqual(['npm test']);
    expect(turns[1].cost).toBeCloseTo(0.15);
    expect(totalCost).toBe(0.25);
  });
});
