import { appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { allowedPeer, allowedRequest } from '../server/src/http/access.js';

function reloadOnlyOnChange(): Plugin {
  let changed = Date.now();
  return {
    name: 'reload-only-on-change',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.on('connection', (socket) => {
        let ok = false;
        try {
          ok = allowedPeer(socket.remoteAddress);
        } catch {}
        if (!ok) socket.destroy();
      });
      server.watcher.on('all', () => (changed = Date.now()));
      server.middlewares.use('/__changed', (req, res) => (allowedRequest(req.headers) ? res.end(String(changed)) : res.writeHead(403).end()));
      server.middlewares.use('/__log', (req, res) => {
        if (req.method !== 'POST' || !allowedRequest(req.headers)) return res.writeHead(403).end();
        let body = '';
        req.on('data', (c) => {
          if (body.length < 2000) body += c;
        });
        req.on('end', () => {
          const dir = path.join(os.homedir(), '.agentview');
          mkdirSync(dir, { recursive: true });
          appendFileSync(path.join(dir, 'lifecycle.log'), `${new Date().toISOString()} ${body.slice(0, 500).replace(/[\r\n]/g, ' ')}\n`);
          res.end();
        });
      });
    },
    transform(code, id) {
      if (!id.includes('vite/dist/client/client.mjs')) return;
      const reload = 'await waitForSuccessfulPing(url.href);\n          location.reload();';
      if (!code.includes(reload)) return;
      return code.replace(reload, 'await waitForSuccessfulPing(url.href);\n          await reloadWhenChanged(lostAt);').replace('const socket = payload.data.webSocket;', 'const lostAt = Date.now() - 5e3;\n          const socket = payload.data.webSocket;') + `
async function reloadWhenChanged(since) {
  while (true) {
    const changed = Number(await fetch("/__changed").then((r) => r.text()).catch(() => 0));
    if (changed > since) return location.reload();
    await wait(10e3);
  }
}
`;
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), reloadOnlyOnChange()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    allowedHosts: ['.netbird.cloud'],
    proxy: {
      '/api': { target: `http://localhost:${process.env.AV_PORT ?? 7777}`, xfwd: true },
      '/ws': { target: `ws://localhost:${process.env.AV_PORT ?? 7777}`, ws: true },
    },
  },
});
