import { useSyncExternalStore } from 'react';

type Known = { url: string; name?: string };
type Shell = { macs?: () => string; remember?: (url: string, name: string) => void };

const KEY = 'agentview.url';
const MAC_URL = 'http://anshumans-macbook-pro.netbird.cloud:7777';
const TRUSTED = /^http:\/\/([a-z0-9-]+\.netbird\.cloud|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|localhost)(:\d{1,5})?$/i;

export const shell = () => (window as { AgentViewShell?: Shell }).AgentViewShell;

// The bundled app loads from the app's own origin and talks to a Mac; a page a Mac serves uses relative URLs.
export const bundled = typeof location !== 'undefined' && (location.hostname === 'tauri.localhost' || location.protocol === 'tauri:');

export const trusted = (url: string) => TRUSTED.test(url);

// A Mac cannot reach its own NetBird address, so the Mac the user sits at (self) opens on localhost.
export const macUrl = (m: { url: string; self?: boolean }, port: string) => (m.self ? `http://localhost${port ? `:${port}` : ''}` : m.url);

export function knownMacs(): Known[] {
  try {
    return (JSON.parse(shell()?.macs?.() ?? '[]') as Known[]).filter((m) => trusted(m.url));
  } catch {
    return [];
  }
}

const read = () => {
  try {
    return localStorage.getItem(KEY)?.replace(/:5173$/, ':7777') || '';
  } catch {
    return '';
  }
};

let base = bundled ? read() || knownMacs()[0]?.url || (/Android/i.test(navigator.userAgent) ? MAC_URL : 'http://localhost:7777') : '';
const listeners = new Set<() => void>();

export const apiBase = () => base;
export const apiUrl = (path: string) => base + path;
export const wsUrl = (query: string) => `${base ? base.replace(/^http/, 'ws') : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`}/ws?${query}`;
export const macOrigin = () => base || location.origin;
export const macPort = () => (base ? new URL(base).port : location.port);

export function setApiBase(url: string) {
  base = url.replace(/\/+$/, '');
  try {
    localStorage.setItem(KEY, base);
  } catch {}
  listeners.forEach((l) => l());
}

export const useApiBase = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => base,
  );
