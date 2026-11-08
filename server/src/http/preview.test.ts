import { describe, expect, it } from 'vitest';
import { parsePorts } from './preview.js';

describe('parsePorts', () => {
  it('lists dev servers and marks loopback-only ports', () => {
    const out = ['p1', 'cnode', 'f1', 'n127.0.0.1:5173', 'f2', 'n[::1]:5173', 'p2', 'cbun', 'n*:3000', 'p3', 'cpostgres', 'n127.0.0.1:5432', 'p4', 'cbun', 'n*:7777', 'p5', 'cjava', 'n127.0.0.1:53017', 'p6', 'cPython', 'n127.0.0.1:8011'].join('\n');
    expect(parsePorts(out)).toEqual([
      { port: 3000, name: 'bun', local: false },
      { port: 5173, name: 'node', local: true },
      { port: 8011, name: 'Python', local: true },
    ]);
  });

  it('treats a port bound anywhere as reachable', () => {
    expect(parsePorts('cnode\nn127.0.0.1:4000\nn*:4000')).toEqual([{ port: 4000, name: 'node', local: false }]);
  });
});
