import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function reloadOnlyOnChange(): Plugin {
  let changed = Date.now();
  return {
    name: 'reload-only-on-change',
    apply: 'serve',
    configureServer(server) {
      server.watcher.on('all', () => (changed = Date.now()));
      server.middlewares.use('/__changed', (_req, res) => res.end(String(changed)));
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
  plugins: [react(), reloadOnlyOnChange()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['.netbird.cloud'],
    proxy: {
      '/api': 'http://localhost:7777',
      '/ws': { target: 'ws://localhost:7777', ws: true },
    },
  },
});
