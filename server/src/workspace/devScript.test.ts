import { describe, expect, it } from 'bun:test';
import { devCommand } from './devScript.js';

describe('devCommand', () => {
  it('runs the dev script with the lockfile package manager', () => {
    const pkg = JSON.stringify({ scripts: { start: 'node x', dev: 'vite' } });
    expect(devCommand(pkg, (f) => f === 'pnpm-lock.yaml')).toEqual({ script: 'dev', command: 'pnpm dev' });
    expect(devCommand(pkg, (f) => f === 'bun.lock')).toEqual({ script: 'dev', command: 'bun run dev' });
    expect(devCommand(JSON.stringify({ scripts: { serve: 'x' } }), () => false)).toEqual({ script: 'serve', command: 'npm run serve' });
  });

  it('finds nothing without a known script', () => {
    expect(devCommand(JSON.stringify({ scripts: { build: 'tsc' } }), () => false)).toBeNull();
    expect(devCommand('', () => false)).toBeNull();
  });
});
