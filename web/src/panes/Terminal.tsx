import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export function Terminal({ chat }: { chat: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new XTerm({
      fontFamily: "'SF Mono', Menlo, Monaco, monospace",
      fontSize: 12,
      cursorBlink: true,
      theme: { background: '#181818', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#264f78' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?term=${encodeURIComponent(chat)}`);
    const resize = () => {
      if (!host.current?.offsetHeight) return;
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'r', c: term.cols, r: term.rows }));
    };
    ws.onopen = resize;
    ws.onmessage = (e) => term.write(e.data);
    ws.onclose = () => term.write('\r\n\x1b[2m[shell exited]\x1b[0m\r\n');
    term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: 'i', d })));
    const ro = new ResizeObserver(resize);
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  }, [chat]);

  return <div className="term-host" ref={host} />;
}
