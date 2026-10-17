import { useState } from 'react';

export type Theme = 'graphite' | 'dark-modern';

const KEY = 'agentview.theme';
export const THEME_NAMES: Record<Theme, string> = { graphite: 'Graphite', 'dark-modern': 'Dark Modern' };

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark-modern' ? 'dark-modern' : 'graphite';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggle = () => {
    const next: Theme = theme === 'graphite' ? 'dark-modern' : 'graphite';
    applyTheme(next);
    setTheme(next);
  };
  return [theme, toggle];
}
