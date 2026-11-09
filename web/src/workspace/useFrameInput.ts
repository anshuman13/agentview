import { useRef, type FormEvent, type KeyboardEvent, type MutableRefObject, type PointerEvent, type RefObject } from 'react';

const BUTTON = ['left', 'middle', 'right'];
const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

type Send = (m: object) => unknown;

// Turns pointer, wheel and key events on the drawn frame into input for the page in Chrome.
export function useFrameInput(send: Send, img: RefObject<HTMLImageElement | null>, kbd: RefObject<HTMLTextAreaElement | null>, vp: MutableRefObject<{ w: number; h: number }>) {
  const touch = useRef(false);
  const tap = useRef({ x: 0, y: 0 });

  const pos = (e: { clientX: number; clientY: number }) => {
    if (!img.current) return { x: 0, y: 0 };
    const r = img.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * vp.current.w, y: ((e.clientY - r.top) / r.height) * vp.current.h };
  };
  const mouse = (type: string, e: PointerEvent, extra: object) => send({ t: 'mouse', type, ...pos(e), buttons: e.buttons, modifiers: mods(e), ...extra });

  const onDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType !== 'mouse') {
      touch.current = true;
      tap.current = { x: e.clientX, y: e.clientY };
      send({ t: 'touch', type: 'touchStart', ...pos(e) });
      return;
    }
    e.preventDefault();
    kbd.current?.focus({ preventScroll: true });
    mouse('mousePressed', e, { button: BUTTON[e.button] ?? 'left', clickCount: e.detail || 1 });
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      if (touch.current) send({ t: 'touch', type: 'touchMove', ...pos(e) });
      return;
    }
    mouse('mouseMoved', e, { button: 'none' });
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      if (touch.current) send({ t: 'touch', type: 'touchEnd', ...pos(e) });
      // Focus inside the tap itself, as phones only open the keyboard from a user gesture.
      if (touch.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) < 8) kbd.current?.focus({ preventScroll: true });
      touch.current = false;
      return;
    }
    mouse('mouseReleased', e, { button: BUTTON[e.button] ?? 'left', clickCount: e.detail || 1 });
  };
  const onCancel = () => {
    if (touch.current) send({ t: 'touch', type: 'touchCancel', x: 0, y: 0 });
    touch.current = false;
  };
  const onWheel = (e: React.WheelEvent) => send({ t: 'wheel', ...pos(e), dx: e.deltaX, dy: e.deltaY });

  const onKey = (e: KeyboardEvent) => {
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) return;
    if (e.key === 'Unidentified' || e.key === 'Process') return;
    if (e.metaKey && e.key === 'v') return;
    // A key sent to the page is not also an app shortcut; ⌘I in a page's editor must not open Codex.
    e.preventDefault();
    e.stopPropagation();
    send({ t: 'key', key: e.key, code: e.code, keyCode: e.keyCode, modifiers: mods(e) });
  };
  const onText = (e: FormEvent<HTMLTextAreaElement>) => {
    const text = e.currentTarget.value;
    e.currentTarget.value = '';
    if (text) send({ t: 'text', text });
  };

  return { onDown, onMove, onUp, onCancel, onWheel, onKey, onText };
}
