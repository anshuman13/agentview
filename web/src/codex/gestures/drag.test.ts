import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubGlobal, unstubAllGlobals } from '../../../../testing';

vi.mock('react', () => ({ useRef: (v: unknown) => ({ current: v }), useState: (v: unknown) => [v, () => {}] }));
vi.mock('../../ui/haptic', () => ({ haptic: vi.fn() }));

const { haptic } = await import('../../ui/haptic');
const { useDrag } = await import('./drag');

type Handler = (ev: unknown) => void;
let handlers: Record<string, Handler>;
let target: unknown;

beforeEach(() => {
  vi.useFakeTimers();
  (haptic as ReturnType<typeof vi.fn>).mockClear();
  handlers = {};
  target = { closest: () => ({ dataset: { drop: 'today' }, querySelectorAll: () => [] }) };
  stubGlobal('window', {
    addEventListener: (name: string, fn: Handler) => (handlers[name] = fn),
    removeEventListener: () => {},
  });
  stubGlobal('document', { elementFromPoint: () => target });
  stubGlobal('requestAnimationFrame', () => 0);
  stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.useRealTimers();
  unstubAllGlobals();
});

function press(pointerType: string, onHold?: () => void) {
  const onDrop = vi.fn();
  const { start } = useDrag(onDrop, { current: null }, 'row', onHold);
  start({ id: 1 }, 'k', 'T')({ button: 0, pointerType, clientX: 0, clientY: 0, target: { closest: () => null } } as never);
  return onDrop;
}

describe('useDrag haptic', () => {
  it('taps at pick-up and again on a touch drop', () => {
    const onDrop = press('touch');
    vi.advanceTimersByTime(400);
    expect(haptic).toHaveBeenCalledTimes(1);
    handlers.touchmove({ touches: [{ clientX: 0, clientY: 40 }], cancelable: false });
    handlers.touchend({});
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledTimes(2);
  });

  it('does not tap on release over nothing', () => {
    const onDrop = press('touch');
    vi.advanceTimersByTime(400);
    target = { closest: () => null };
    handlers.touchmove({ touches: [{ clientX: 0, clientY: 40 }], cancelable: false });
    handlers.touchend({});
    expect(onDrop).not.toHaveBeenCalled();
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it('does not tap for a hold released without moving', () => {
    const onHold = vi.fn();
    const onDrop = press('touch', onHold);
    vi.advanceTimersByTime(400);
    handlers.touchend({});
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled();
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it('never taps for a mouse drag', () => {
    const onDrop = press('mouse');
    handlers.pointermove({ clientX: 0, clientY: 40, cancelable: false });
    handlers.pointerup({});
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(haptic).not.toHaveBeenCalled();
  });
});
