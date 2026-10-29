import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'agentview.theme';
const ORDER: Theme[] = ['dark', 'light'];
export const THEME_NAMES: Record<Theme, string> = { dark: 'Dark', light: 'Light' };
const isTheme = (t: unknown): t is Theme => ORDER.includes(t as Theme);

export function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return isTheme(t) ? t : 'dark';
}

export const isDark = (t: Theme) => t === 'dark';

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.removeAttribute('media'); m.setAttribute('content', bg); });
  window.dispatchEvent(new Event('agentview:theme'));
}

// Watches the theme set at boot (index.html) and by the toggle.
export function useThemeName(): Theme {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const on = () => setTheme(currentTheme());
    window.addEventListener('agentview:theme', on);
    return () => window.removeEventListener('agentview:theme', on);
  }, []);
  return theme;
}

export function useTheme(): [Theme, () => void] {
  const theme = useThemeName();
  useEffect(() => {
    // With no stored choice the page follows the system setting, live.
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(KEY);
      } catch {}
      if (!isTheme(stored)) applyTheme(mq.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const toggle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    applyTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {}
  };
  return [theme, toggle];
}
