import { defineConfig } from '@playwright/test';

const WEB = Number(process.env.E2E_PORT ?? 5199);
const STUB = Number(process.env.STUB_PORT ?? 7788);

// Web e2e suite: Vite on :5199 proxies /api to the stub server on :7788 (E2E_PORT, STUB_PORT), never to a live server or the hub.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  workers: 2,
  forbidOnly: true,
  timeout: 15_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB}`,
    channel: 'chrome',
    headless: true,
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  ],
  webServer: [
    { command: 'bun e2e/stub.ts', port: STUB, reuseExistingServer: false, env: { STUB_PORT: String(STUB) } },
    { command: `bun run dev --port ${WEB}`, port: WEB, reuseExistingServer: false, env: { AV_PORT: String(STUB) } },
  ],
});
