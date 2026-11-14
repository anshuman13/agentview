import { describe, expect, it } from 'bun:test';
import { failure, REASON_STATUS, relayStatus, type Reason } from './launch.js';

// Bun's text for a WebSocket upgrade that got another status.
const upgradeError = (status: number) => new Error(`Expected 101 status code: ${status}`);

describe('Chrome failure reasons', () => {
  it('reads each reason the relay answers back from the status', async () => {
    for (const reason of Object.keys(REASON_STATUS) as Reason[]) {
      expect(await failure(upgradeError(await relayStatus(new Error(reason))))).toBe(reason);
    }
  });

  it('maps errors from Chrome itself', async () => {
    expect(await relayStatus(new Error('Expected 101 status code: 404'))).toBe(404);
    expect(await relayStatus(new Error('Expected 101 status code: 403'))).toBe(403);
    expect(await relayStatus(new Error('Opening Chrome timed out'))).toBe(504);
    expect(await relayStatus(new Error('something else'))).toBe(502);
    expect(await failure(new Error('WebSocket handshake has timed out'))).toBe('timeout');
    expect(await failure(new Error('something else'))).toBe('something else');
  });
});
