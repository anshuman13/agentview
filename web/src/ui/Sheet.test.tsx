import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { stubGlobal } from '../../../testing';

const require = createRequire(import.meta.url);
const react = require('react') as typeof import('react');
const reactDom = require('react-dom') as typeof import('react-dom');
let backs = 0;
vi.mock('react', () => ({ ...react, useEffect: (run: () => void) => { run(); }, useState: () => [backs, (f: (n: number) => number) => { backs = f(backs); }] }));
vi.mock('react-dom', () => ({ ...reactDom, createPortal: (node: unknown) => node }));
vi.mock('./useSheetDrag', () => ({ useSheetDrag: (_: boolean, onClose: () => void) => ({ close: onClose, handle: {} }) }));
let back: () => void = () => {};
vi.mock('../app/touch/back', () => ({ Back: ({ close }: { close: () => void }) => { back = close; return null; } }));
let keys: ((e: { key: string }) => void)[] = [];
stubGlobal('window', { addEventListener: (_: string, f: (e: { key: string }) => void) => keys.push(f), removeEventListener: () => {} });
stubGlobal('document', { body: {} });

const { Sheet } = await import('./Sheet');

const open = (props: { onClose: () => void; onBack?: () => void }) => {
  renderToStaticMarkup(<Sheet label="Memory" {...props}>x</Sheet>);
  return () => keys.at(-1)!({ key: 'Escape' });
};

describe('Sheet', () => {
  beforeEach(() => { keys = []; backs = 0; });

  it('Esc and the touch Back call onBack when given', () => {
    const onClose = vi.fn(), onBack = vi.fn();
    open({ onClose, onBack })();
    back();
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('pushes a new Back entry on every Esc and Back while the sheet stays open', () => {
    open({ onClose: vi.fn(), onBack: vi.fn() })();
    back();
    expect(backs).toBe(2);
  });

  it('Esc and the touch Back close the sheet without onBack', () => {
    const onClose = vi.fn();
    open({ onClose })();
    back();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
