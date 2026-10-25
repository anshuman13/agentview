import { beforeEach, describe, expect, it } from 'vitest';
import { allowedPeer, allowedRequest, appOrigin, canon, loadStatus, requester } from './access.js';

const status = JSON.stringify({
  daemonStatus: 'Connected',
  netbirdIp: '100.102.198.21/16',
  netbirdIpv6: 'fd71:58b7:cd10:35cc:8881:f43d:373d:8268/64',
  peers: {
    details: [
      { fqdn: 'laptop.netbird.cloud', netbirdIp: '100.102.26.124', netbirdIpv6: 'fd71:58b7:cd10:35cc:b910:535d:54b3:3633' },
      { fqdn: 'phone.netbird.cloud', netbirdIp: '100.102.111.164' },
    ],
  },
});

beforeEach(() => loadStatus(status));

describe('allowedPeer', () => {
  it('accepts loopback and listed peers in any spelling', () => {
    expect(allowedPeer('127.0.0.1')).toBe(true);
    expect(allowedPeer('::1')).toBe(true);
    expect(allowedPeer('::ffff:127.0.0.1')).toBe(true);
    expect(allowedPeer('100.102.26.124')).toBe(true);
    expect(allowedPeer('::ffff:100.102.26.124')).toBe(true);
    expect(allowedPeer('100.102.198.21')).toBe(true);
    expect(allowedPeer('FD71:58B7:CD10:35CC:B910:535D:54B3:3633')).toBe(true);
    expect(allowedPeer('fd71:58b7:cd10:35cc:b910:535d:54b3:3633%utun100')).toBe(true);
  });

  it('refuses the LAN, other CGNAT addresses and the NetBird prefix with an unknown host part', () => {
    expect(allowedPeer('192.168.1.20')).toBe(false);
    expect(allowedPeer('100.127.0.5')).toBe(false);
    expect(allowedPeer('100.102.0.9')).toBe(false);
    expect(allowedPeer('fd71:58b7:cd10:35cc::1')).toBe(false);
    expect(allowedPeer('fe80::1')).toBe(false);
    expect(allowedPeer('')).toBe(false);
    expect(allowedPeer(undefined)).toBe(false);
  });

  it('allows only loopback when NetBird is not running', () => {
    loadStatus(null);
    expect(allowedPeer('127.0.0.1')).toBe(true);
    expect(allowedPeer('100.102.26.124')).toBe(false);
    loadStatus('not json');
    expect(allowedPeer('100.102.26.124')).toBe(false);
  });
});

describe('canon', () => {
  it('normalises address spellings', () => {
    expect(canon('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(canon('[FD71:0000:0000:0000:0000:0000:0000:0001]')).toBe('fd71::1');
    expect(canon('fe80::1%en0')).toBe('fe80::1');
    expect(canon('100.102.198.21/16')).toBe('100.102.198.21');
  });
});

describe('allowedRequest', () => {
  const own = (host: string) => ({ host, origin: `http://${host}` });

  it('accepts pages served by this server', () => {
    expect(allowedRequest(own('localhost:5173'))).toBe(true);
    expect(allowedRequest(own('127.0.0.1:7777'))).toBe(true);
    expect(allowedRequest(own('macmini.netbird.cloud:5173'))).toBe(true);
    expect(allowedRequest(own('100.102.26.124:5173'))).toBe(true);
    expect(allowedRequest(own('[fd71:58b7:cd10:35cc:b910:535d:54b3:3633]:5173'))).toBe(true);
    expect(allowedRequest({ host: 'localhost:7777' })).toBe(true);
    expect(allowedRequest({ host: 'localhost:7777', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' })).toBe(true);
  });

  it('refuses other hosts, including DNS rebinding names', () => {
    expect(allowedRequest({ host: 'evil.example' })).toBe(false);
    expect(allowedRequest({ host: '192.168.1.5:7777' })).toBe(false);
    expect(allowedRequest({ host: 'localhost.evil.example' })).toBe(false);
    expect(allowedRequest({ host: 'evil@localhost:7777' })).toBe(false);
    expect(allowedRequest({ host: '' })).toBe(false);
  });

  it('refuses pages from other origins, even other local servers', () => {
    expect(allowedRequest({ host: 'localhost:7777', origin: 'http://localhost:3000' })).toBe(false);
    expect(allowedRequest({ host: 'localhost:7777', origin: 'http://evil.example' })).toBe(false);
    expect(allowedRequest({ host: 'localhost:7777', origin: 'null' })).toBe(false);
    expect(allowedRequest({ host: 'macmini.netbird.cloud:5173', origin: 'http://laptop.netbird.cloud:5173' })).toBe(false);
    expect(allowedRequest({ host: 'localhost:7777', origin: 'https://localhost:7777' })).toBe(false);
  });

  it('refuses cross-site loads that carry no Origin, but lets navigations in', () => {
    expect(allowedRequest({ host: 'localhost:7777', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' })).toBe(false);
    expect(allowedRequest({ host: 'localhost:7777', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors' })).toBe(false);
    expect(allowedRequest({ host: 'localhost:7777', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' })).toBe(true);
    expect(allowedRequest({ host: 'localhost:7777', 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' })).toBe(true);
  });
});

describe('bundled app origin', () => {
  const app = (origin: string, extra = {}) => ({ host: 'macmini.netbird.cloud:7777', origin, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', ...extra });

  it('is accepted from loopback and NetBird peers', () => {
    for (const origin of ['http://tauri.localhost', 'tauri://localhost']) {
      expect(allowedRequest(app(origin), '100.102.111.164')).toBe(true);
      expect(allowedRequest(app(origin), '127.0.0.1')).toBe(true);
      expect(appOrigin(app(origin), '100.102.111.164')).toBe(origin);
    }
  });

  it('is refused from other addresses or without one', () => {
    expect(allowedRequest(app('http://tauri.localhost'), '192.168.1.20')).toBe(false);
    expect(allowedRequest(app('http://tauri.localhost'))).toBe(false);
    expect(appOrigin(app('http://tauri.localhost'), '192.168.1.20')).toBeUndefined();
  });

  it('does not widen other origins or hosts', () => {
    expect(allowedRequest(app('http://evil.example'), '100.102.111.164')).toBe(false);
    expect(allowedRequest(app('https://tauri.localhost'), '100.102.111.164')).toBe(false);
    expect(allowedRequest(app('http://tauri.localhost', { host: 'evil.example' }), '100.102.111.164')).toBe(false);
  });
});

describe('requester', () => {
  const req = (remoteAddress: string, fwd?: string) => ({ socket: { remoteAddress }, headers: fwd ? { 'x-forwarded-for': fwd } : {} }) as never;

  it('trusts X-Forwarded-For only from the local proxy', () => {
    expect(requester(req('::ffff:127.0.0.1', '100.102.26.124'))).toBe('100.102.26.124');
    expect(requester(req('127.0.0.1', '100.102.26.124, 10.0.0.1'))).toBe('100.102.26.124');
    expect(requester(req('100.102.26.124', '127.0.0.1'))).toBe('100.102.26.124');
    expect(requester(req('::ffff:100.102.26.124'))).toBe('100.102.26.124');
    expect(requester(req('127.0.0.1'))).toBe('127.0.0.1');
  });
});
