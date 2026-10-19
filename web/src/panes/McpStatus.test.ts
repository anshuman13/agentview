import { describe, expect, it } from 'vitest';
import { merge } from './McpStatus';

describe('merge', () => {
  it('drops the probe error once the chat has the server connected', () => {
    const probed = [{ name: 'gw', status: 'needs-auth', scope: 'user', error: 'gw needs login (HTTP 401)' }];
    const live = JSON.parse(JSON.stringify([{ name: 'gw', status: 'connected', error: undefined }]));
    expect(merge(probed, live)[0]).toMatchObject({ status: 'connected', error: undefined, live: true, scope: 'user' });
  });
});
