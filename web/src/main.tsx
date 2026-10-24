/// <reference types="vite/client" />
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';
import { touch } from './touch';
import { api } from './store';

if (touch()) window.addEventListener('focusout', () => window.scrollTo(0, 0));

// The Mac app's WKWebView drops target=_blank links, so the server opens them in Chrome.
if (/Macintosh/.test(navigator.userAgent) && !/Safari\//.test(navigator.userAgent)) {
  window.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!(a instanceof HTMLAnchorElement) || e.defaultPrevented || e.button !== 0 || !/^https?:$/.test(a.protocol) || a.origin === location.origin) return;
    e.preventDefault();
    void fetch(api('/api/open'), { method: 'POST', body: JSON.stringify({ url: a.href }) });
  });
}

if (import.meta.hot) {
  const nav = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type;
  const log = (ev: string) => navigator.sendBeacon('/__log', JSON.stringify({ ev, nav, ua: /; wv\)/.test(navigator.userAgent) ? 'app' : 'browser', w: innerWidth, up: Math.round(performance.now() / 1000) }));
  log('load');
  Object.assign(window, { avlog: log });
  document.addEventListener('visibilitychange', () => log(document.visibilityState));
  addEventListener('pagehide', (e) => log(`pagehide persisted=${e.persisted}`));
  addEventListener('pageshow', (e) => e.persisted && log('pageshow bfcache'));
  import.meta.hot.on('vite:beforeFullReload', () => log('vite full-reload'));
  import.meta.hot.on('vite:ws:disconnect', () => log('vite ws lost'));
}

createRoot(document.getElementById('root')!).render(<App />);
