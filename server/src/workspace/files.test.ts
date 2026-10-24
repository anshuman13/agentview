import { describe, expect, it } from 'vitest';
import { safeResolve } from './files.js';

describe('safeResolve', () => {
  it('resolves a relative path inside the project', () => {
    expect(safeResolve('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
    expect(safeResolve('/repo', '')).toBe('/repo');
    expect(safeResolve('/repo', 'src/../README.md')).toBe('/repo/README.md');
  });

  it('refuses paths that leave the project', () => {
    expect(() => safeResolve('/repo', '../x')).toThrow('path outside project');
    expect(() => safeResolve('/repo', '/etc/passwd')).toThrow('path outside project');
    expect(() => safeResolve('/repo', 'a/../../x')).toThrow('path outside project');
    expect(() => safeResolve('/repo', '/repo2/x')).toThrow('path outside project');
  });
});
