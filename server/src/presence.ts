export const DESKTOP_ACTIVE_MS = 3 * 60_000;

const PHONE_UA = /Android|iPhone|iPad|iPod/i;

export function isPhone(client: string | null | undefined, userAgent: string | undefined) {
  return client === 'phone' || PHONE_UA.test(userAgent ?? '');
}

// The last time a desktop client (a browser tab or the menu bar) connected or sent a command.
export function createPresence(now: () => number = Date.now) {
  let last = 0;
  return {
    touch: () => void (last = now()),
    at: () => last,
    active: () => last > 0 && now() - last < DESKTOP_ACTIVE_MS,
  };
}

export function desktopActive(at: number, now = Date.now()) {
  return at > 0 && now - at < DESKTOP_ACTIVE_MS;
}
