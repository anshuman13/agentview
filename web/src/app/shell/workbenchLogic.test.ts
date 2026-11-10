import { describe, expect, it } from 'vitest';
import { activeOf, showingOf, type Editor } from './workbenchLogic';
import type { Tab } from './TabBar';

describe('showingOf', () => {
  const cases: [Tab, Editor, Editor][] = [
    ['assistant', 'file', 'assistant'],
    ['browser', 'file', 'browser'],
    ['agents', 'settings', 'agents'],
    ['code', 'file', 'file'],
    ['code', 'browser', 'file'],
    ['code', 'observe', 'observe'],
    ['chat', 'browser', 'browser'],
    ['repos', 'mcp', 'mcp'],
  ];
  for (const [tab, editor, expected] of cases) it(`${tab} tab with ${editor} editor shows ${expected}`, () => expect(showingOf(tab, editor)).toBe(expected));
});

describe('activeOf', () => {
  const cases: [Editor, boolean, string | null, string][] = [
    ['assistant', true, null, 'assistant'],
    ['browser', true, 'a.ts', 'offline'],
    ['file', true, 'a.ts', 'offline'],
    ['browser', false, null, 'browser'],
    ['agents', false, 'a.ts', 'agents'],
    ['deploy', false, null, 'deploy'],
    ['file', false, 'a.ts', 'file'],
    ['file', false, null, 'empty'],
  ];
  for (const [showing, unreachable, openFile, expected] of cases) {
    it(`${showing}${unreachable ? ' offline' : ''}${openFile ? ' with a file' : ''} is ${expected}`, () => expect(activeOf(showing, unreachable, openFile)).toBe(expected));
  }
});
