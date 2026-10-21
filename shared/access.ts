const NETBIRD = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/;

export const allowedPeer = (addr = '') => {
  const a = addr.replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || NETBIRD.test(a);
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
