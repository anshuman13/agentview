import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { touch } from '../app/touch';
import { wsUrl } from '../ui/util';

// ANSI colours come from the theme tokens, so the terminal matches the app.
function termTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--${name}`).trim();
  const [red, green, yellow, blue, magenta, cyan] = ['hue-red', 'hue-green', 'hue-yellow', 'hue-blue', 'hue-magenta', 'hue-sky'].map(v);
  return {
    background: v('surface'),
    foreground: v('fg'),
    cursor: v('fg'),
    selectionBackground: v('accent-soft'),
    selectionInactiveBackground: v('hover'),
    black: v('sunken'),
    red, green, yellow, blue, magenta, cyan,
    white: v('fg'),
    brightBlack: v('fg-faint'),
    brightRed: red, brightGreen: green, brightYellow: yellow, brightBlue: blue, brightMagenta: magenta, brightCyan: cyan,
    brightWhite: v('fg-strong'),
  };
}

export function Pane({ id, on, focus, clears, inputs, onGone }: { id: string; on: boolean; focus: number; clears: Map<string, () => void>; inputs: Map<string, (d: string) => void>; onGone: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const want = useRef(false);
  const gone = useRef(onGone);
  gone.current = onGone;

  useEffect(() => {
    const el = host.current!;
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
    const xt = new XTerm({ fontFamily: mono || "'SF Mono', Menlo, Monaco, monospace", fontSize: 13, scrollback: 5000, cursorBlink: true, theme: termTheme() });
    const retheme = () => (xt.options.theme = termTheme());
    window.addEventListener('agentview:theme', retheme);
    const fit = new FitAddon();
    xt.loadAddon(fit);
    term.current = xt;
    const ws = new WebSocket(wsUrl(`term=${encodeURIComponent(id)}`));
    const send = (m: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
    const clear = () => {
      xt.clear();
      send({ t: 'c' });
    };
    clears.set(id, clear);
    inputs.set(id, (d) => send({ t: 'i', d }));
    const resize = () => {
      if (!el.offsetHeight || !el.offsetWidth) return;
      if (!xt.element) xt.open(el);
      fit.fit();
      send({ t: 'r', c: xt.cols, r: xt.rows });
      if (want.current) {
        want.current = false;
        xt.focus();
      }
    };
    xt.attachCustomKeyEventHandler((e) => {
      if (!e.metaKey || e.type !== 'keydown') return true;
      const k = e.key.toLowerCase();
      if (k === 'k') {
        e.preventDefault();
        clear();
      }
      return k !== 'k' && k !== 'j';
    });
    ws.onopen = resize;
    ws.onmessage = (e) => xt.write(e.data);
    ws.onclose = () => gone.current();
    xt.onData((d) => send({ t: 'i', d }));
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      ws.onclose = null;
      ws.close();
      window.removeEventListener('agentview:theme', retheme);
      clears.delete(id);
      inputs.delete(id);
      xt.dispose();
    };
  }, [id]);

  useEffect(() => {
    if (!focus || touch()) return;
    const xt = term.current;
    if (xt?.element && host.current?.offsetHeight) xt.focus();
    else want.current = true;
  }, [focus]);

  return <div className={`term-host term-pane${on ? ' on' : ''}`} ref={host} />;
}
