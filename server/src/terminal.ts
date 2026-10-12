import { spawn } from 'node-pty';
import { WebSocket } from 'ws';

export function openTerminal(ws: WebSocket, cwd: string) {
  const pty = spawn(process.env.SHELL || '/bin/zsh', ['-l'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  });
  pty.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(d));
  pty.onExit(() => ws.close());
  ws.on('message', (raw) => {
    let m: { t: string; d?: string; c?: number; r?: number };
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.t === 'i' && typeof m.d === 'string') pty.write(m.d);
    if (m.t === 'r' && m.c && m.r) pty.resize(Math.max(2, Math.floor(m.c)), Math.max(2, Math.floor(m.r)));
  });
  ws.on('close', () => pty.kill());
}
