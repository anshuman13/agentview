import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { appSignIn, listApps, toggleApp } from './connectors.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const stub = (reply: (method: string, params: any) => unknown) => {
  const sent: Array<[string, unknown]> = [];
  const rpc = {
    request: async <T,>(method: string, params: unknown) => {
      sent.push([method, params]);
      return reply(method, params) as T;
    },
  };
  return { rpc, sent };
};

describe('codex connectors', () => {
  it('maps app/list pages and app/installed onto one group', async () => {
    const { rpc, sent } = stub((method, params) =>
      method === 'app/installed' ? fixture('app-installed.json') : fixture(params.cursor ? 'app-list-2.json' : 'app-list.json'));
    expect(await listApps(rpc, true)).toEqual([{
      label: 'ChatGPT apps',
      connectors: [
        { id: 'asdk_app_gmail', name: 'Gmail', status: 'connected', enabled: true, icon: 'https://cdn.example/gmail.png' },
        { id: 'asdk_app_linear', name: 'Linear', status: 'needs-auth', enabled: true, signInUrl: 'https://chatgpt.com/apps/linear/asdk_app_linear' },
        { id: 'asdk_app_github', name: 'GitHub', status: 'off', enabled: false },
        { id: 'asdk_app_drive', name: 'Google Drive', status: 'failed', enabled: true },
      ],
    }]);
    expect(sent).toEqual([
      ['app/list', { cursor: null, limit: 200, forceRefetch: true }],
      ['app/list', { cursor: 'page2', limit: 200, forceRefetch: true }],
      ['app/installed', { forceRefresh: true }],
    ]);
  });

  it('toggles an app through config/value/write', async () => {
    const { rpc, sent } = stub(() => ({ status: 'ok' }));
    expect(await toggleApp(rpc, 'asdk_app_gmail', false)).toBe(true);
    expect(sent).toEqual([['config/value/write', { keyPath: 'apps.asdk_app_gmail.enabled', value: false, mergeStrategy: 'upsert' }]]);
  });

  it('signs in through the install url from app/read', async () => {
    const { rpc, sent } = stub(() => ({ apps: [{ id: 'asdk_app_linear', name: 'Linear', installUrl: 'https://chatgpt.com/apps/linear' }], missingAppIds: [] }));
    expect(await appSignIn(rpc, 'asdk_app_linear')).toBe('https://chatgpt.com/apps/linear');
    expect(sent).toEqual([['app/read', { appIds: ['asdk_app_linear'] }]]);
    expect(await appSignIn(stub(() => ({ apps: [], missingAppIds: ['x'] })).rpc, 'x')).toBeNull();
  });
});
