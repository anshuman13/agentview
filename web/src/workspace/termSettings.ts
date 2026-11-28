export type TermSettings = { copyOnSelect: boolean; scrollback: number };

export const SCROLLBACKS = [5000, 10000];
const KEY = 'agentview.terminal';
const EVENT = 'agentview:term-settings';
const DEFAULTS: TermSettings = { copyOnSelect: false, scrollback: 5000 };

export function parseTermSettings(raw: string | null): TermSettings {
  try {
    const v = JSON.parse(raw ?? '{}');
    return {
      copyOnSelect: v.copyOnSelect === true,
      scrollback: SCROLLBACKS.includes(v.scrollback) ? v.scrollback : DEFAULTS.scrollback,
    };
  } catch {
    return DEFAULTS;
  }
}

export function termSettings(): TermSettings {
  try {
    return parseTermSettings(localStorage.getItem(KEY));
  } catch {
    return DEFAULTS;
  }
}

export function setTermSettings(change: Partial<TermSettings>) {
  const next = { ...termSettings(), ...change };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function onTermSettings(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
