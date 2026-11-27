import { describe, expect, it } from 'bun:test';
import { devServersFrom, etimeSeconds, inFolder, serverName } from './devServers';

const lsof = ['p100', 'cnode', 'f20', 'n127.0.0.1:5173', 'f21', 'n[::1]:5173', 'p200', 'cpython3.13', 'f5', 'n*:8000', 'p300', 'cclaude', 'f9', 'n127.0.0.1:65256', 'p400', 'cbun', 'f9', 'n*:7790', ''].join('\n');
const cwds = ['p100', 'fcwd', 'n/w/app/web', 'p200', 'fcwd', 'n/w/app', 'p300', 'fcwd', 'n/w/app', 'p400', 'fcwd', 'n/w/apple'].join('\n');
const ps = ['  100    03:00 node /w/app/web/node_modules/.bin/vite --port 5173', '  200 01-02:00:05 /usr/bin/python3 -m http.server 8000', '  400    10:00 bun run server.ts'].join('\n');

describe('dev servers', () => {
  it('lists the ports whose process runs inside the folder, named from the process or package script', () => {
    const now = 1_000_000_000;
    expect(devServersFrom('/w/app', lsof, cwds, ps, now, { '/w/app/web': { dev: 'vite --port 5173' } })).toEqual([
      { port: 5173, pid: 100, name: 'dev (vite)', cwd: '/w/app/web', startedAt: now - 180_000 },
      { port: 8000, pid: 200, name: 'http.server', cwd: '/w/app', startedAt: now - (86400 + 7205) * 1000 },
    ]);
  });

  it('reads elapsed times and folder bounds', () => {
    expect(etimeSeconds('05:07')).toBe(307);
    expect(etimeSeconds('2-01:00:00')).toBe(2 * 86400 + 3600);
    expect(inFolder('/w/app', '/w/app/')).toBe(true);
    expect(inFolder('/w/apple', '/w/app')).toBe(false);
  });

  it('names python scripts and plain executables', () => {
    expect(serverName('/venv/bin/python3 manage.py runserver 0.0.0.0:8000')).toBe('manage.py');
    expect(serverName('/opt/bin/node /w/node_modules/next/dist/bin/next dev')).toBe('next');
    expect(serverName('/usr/local/bin/bun run server.ts')).toBe('bun');
  });
});
