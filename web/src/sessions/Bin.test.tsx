import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { stubGlobal } from '../../../testing';
import type { Folder } from './folders';

stubGlobal('document', { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} });
stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
stubGlobal('matchMedia', () => ({ matches: false }));
stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
stubGlobal('location', { search: '', hash: '' });

const { BinRow } = await import('./Bin');

describe('bin row', () => {
  it('shows Untitled for a chat without a title, and its repo with the hours left', () => {
    const folders: Folder[] = [{ cwd: '/w/agentview', name: 'agentview', trees: [], chats: [], last: 0 }];
    const b = { sessionId: 's1', title: '', cwd: '/w/agentview/server', lastModified: 0, deletedAt: Date.now() - 3600000 };
    const html = renderToStaticMarkup(<BinRow b={b} folders={folders} onRestore={() => {}} onDelete={() => {}} />);
    expect(html).toContain('>Untitled<');
    expect(html).toContain('agentview · 23h left');
  });
});
