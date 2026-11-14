import { useEffect, useRef, useState, type RefObject } from 'react';
import { wsUrl } from '../app/api';

export type Tab = { id: string; title: string; url: string };
export type ChromeState = { state: 'off' | 'connecting' | 'on'; reason: string; retry?: boolean; own?: boolean };

type Refs = { img: RefObject<HTMLImageElement | null>; kbd: RefObject<HTMLTextAreaElement | null>; host: RefObject<HTMLDivElement | null> };

// The socket to the Chrome the server drives: connection state, the tab list, and the frames drawn into img.
export function useChromeSocket({ img, kbd, host }: Refs, phone: boolean, onEmpty?: () => void) {
  const ws = useRef<WebSocket | null>(null);
  const vp = useRef({ w: 0, h: 0 });
  const [state, setState] = useState<ChromeState>({ state: 'connecting', reason: '' });
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const hadTabs = useRef(false);
  const emptied = useRef(onEmpty);
  emptied.current = onEmpty;
  const phoneNow = useRef(phone);
  phoneNow.current = phone;

  const send = (m: object) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(m));
  const sendSize = () => {
    const el = host.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    send({ t: 'size', w: Math.round(r.width * dpr), h: Math.round(r.height * dpr), cssW: Math.round(r.width), cssH: Math.round(r.height), dpr, mobile: phoneNow.current && r.width < 700 });
  };

  const onMessage = (m: { t: string; [k: string]: any }) => {
    if (m.t === 'state') {
      setState(m as unknown as ChromeState);
      if (m.state !== 'on') setHasFrame(false);
    }
    if (m.t === 'tabs') {
      setTabs(m.tabs);
      if (hadTabs.current && m.tabs.length === 0) emptied.current?.();
      hadTabs.current = m.tabs.length > 0;
      setCurrent(m.current);
      setPinned(m.pinned);
    }
    if (m.t === 'editable' && !m.on && document.activeElement === kbd.current) kbd.current?.blur();
    if (m.t === 'frame' && img.current) {
      vp.current = { w: m.w, h: m.h };
      img.current.src = `data:image/jpeg;base64,${m.data}`;
      setHasFrame(true);
    }
  };

  useEffect(() => {
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      timer = undefined;
      const s = new WebSocket(wsUrl('chrome'));
      ws.current = s;
      s.onopen = () => {
        if (ws.current !== s) return;
        delay = 1000;
        sendSize();
      };
      s.onmessage = (ev) => {
        if (ws.current !== s) return;
        onMessage(JSON.parse(ev.data));
      };
      s.onclose = () => {
        if (ws.current !== s) return;
        setState({ state: 'off', reason: 'server', retry: true });
        setHasFrame(false);
        timer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 10000);
      };
    };
    const close = () => {
      clearTimeout(timer);
      timer = undefined;
      const s = ws.current;
      ws.current = null;
      s?.close();
    };
    const onVisibility = () => {
      if (document.hidden) return close();
      if (ws.current && ws.current.readyState <= WebSocket.OPEN) return;
      clearTimeout(timer);
      delay = 1000;
      open();
    };
    document.addEventListener('visibilitychange', onVisibility);
    open();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      close();
    };
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(sendSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.state, phone]);

  return { send, vp, state, tabs, current, pinned, hasFrame };
}
