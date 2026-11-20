import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { createRequire } from 'node:module';
import { stubGlobal } from '../../../../testing';

const require = createRequire(import.meta.url);
const react = require('react') as typeof import('react');
let view = { list: 'search', open: null, tag: null };
const openSearch = vi.fn();
vi.mock('react', () => ({ ...react, useEffect: (run: () => void) => { run(); }, useRef: (current: unknown) => ({ current }) }));
vi.mock('../store', () => ({ getState: () => ({ session: {} }), setUi: vi.fn() }));
vi.mock('../../chat/chatActions', () => ({ sideChat: vi.fn() }));
vi.mock('../../chat/transcript/FindBar', () => ({ requestFind: vi.fn() }));
vi.mock('../../codex/view', () => ({ openSearch, useView: () => view }));
vi.mock('../../ui/util', () => ({ command: vi.fn() }));
vi.mock('./keys', () => ({ MAC: true }));

let keys: ((e: object) => void)[] = [];
const input = { focus: vi.fn() };
stubGlobal('window', { addEventListener: (_: string, f: (e: object) => void) => keys.push(f), removeEventListener: () => {}, getSelection: () => ({ toString: () => 'picked' }) });
stubGlobal('document', {
  body: {},
  activeElement: { closest: (s: string) => (s === '.assistant' ? {} : null) },
  querySelector: (s: string) => (s === '.brief .tr' ? { offsetParent: null } : s === '.as-editor .assistant' ? { offsetParent: {} } : s === '.assistant input[aria-label="Search"]' ? input : null),
});

const { useWorkbenchKeys } = await import('./useWorkbenchKeys');

const cmdF = () => {
  keys = [];
  useWorkbenchKeys({ toggleChat: vi.fn(), toggleSidebar: vi.fn(), toggleTerminal: vi.fn(), switchEditor: vi.fn() });
  keys[0]({ key: 'f', metaKey: true, altKey: false, shiftKey: false, preventDefault: vi.fn() });
};

describe('Cmd+F in Codex', () => {
  beforeEach(() => { openSearch.mockClear(); input.focus.mockClear(); });

  it('focuses the open Search page instead of opening it again', () => {
    view = { list: 'search', open: null, tag: null };
    cmdF();
    expect(input.focus).toHaveBeenCalled();
    expect(openSearch).not.toHaveBeenCalled();
  });

  it('opens Search with the selection from another list', () => {
    view = { list: 'meetings', open: null, tag: null };
    cmdF();
    expect(openSearch).toHaveBeenCalledWith('picked');
    expect(input.focus).not.toHaveBeenCalled();
  });
});
