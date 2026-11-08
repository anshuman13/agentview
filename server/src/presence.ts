export const DESKTOP_ACTIVE_MS = 3 * 60_000;

const PHONE_UA = /Android|iPhone|iPad|iPod/i;

export function isPhone(client: string | null | undefined, userAgent: string | undefined) {
  return client === 'phone' || PHONE_UA.test(userAgent ?? '');
}

// The last time a desktop client (a browser tab) connected or sent a command. The menu bar app reports nothing, so a Mac with only the menu bar open counts as away.
export function createPresence(now: () => number = Date.now) {
  let last = 0;
  return {
    touch: () => void (last = now()),
    at: () => last,
  };
}

export function desktopActive(at: number, now = Date.now()) {
  return at > 0 && now - at < DESKTOP_ACTIVE_MS;
}
