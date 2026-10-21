import os from 'node:os';

const NETBIRD = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/;

const prefix64 = (ip: string) => {
  const [head, tail] = ip.split('%')[0].split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  return [...h, ...Array(8 - h.length - t.length).fill('0'), ...t].slice(0, 4).map((g) => parseInt(g, 16)).join(':');
};

const netbirdV6 = () =>
  Object.values(os.networkInterfaces())
    .filter((addrs) => addrs?.some((a) => a.family === 'IPv4' && NETBIRD.test(a.address)))
    .flatMap((addrs) => addrs!.filter((a) => a.family === 'IPv6' && !a.address.startsWith('fe80')).map((a) => prefix64(a.address)));

export const allowedPeer = (addr = '') => {
  const a = addr.replace(/^::ffff:/, '');
  if (a === '127.0.0.1' || a === '::1' || NETBIRD.test(a)) return true;
  return a.includes(':') && netbirdV6().includes(prefix64(a));
};

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};

const allowedHost = (h: string) =>
  h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]' || NETBIRD.test(h) || h.endsWith('.netbird.cloud');

export const allowedRequest = (headers: { host?: string; origin?: string }) =>
  allowedHost(hostOf(`http://${headers.host ?? ''}`)) && (!headers.origin || allowedHost(hostOf(headers.origin)));
