import { describe, expect, it } from 'bun:test';
import { findFocus, findScope, focusOf, type FindFocus, type FindScope } from './findScope';
import type { List } from '../../codex/view';
import { stubGlobal } from '../../../../testing';

describe('findScope', () => {
  const cases: [string, FindFocus, boolean, boolean, List | null, FindScope][] = [
    ['a sheet, dialog or palette', 'modal', true, true, 'tasks', null],
    ['terminal', 'terminal', true, false, 'today', null],
    ['file editor', 'editor', true, true, 'tasks', null],
    ['sidebar with a chat', 'sidebar', true, false, 'today', 'chat'],
    ['composer', 'chat', true, true, 'tasks', 'chat'],
    ['Codex Tasks', 'codex', true, true, 'tasks', 'tasks'],
    ['wiki index', 'codex', true, true, 'wiki', 'wiki'],
    ['a wiki page', 'codex', true, true, null, 'search'],
    ['Codex Meetings', 'codex', true, true, 'meetings', 'search'],
    ['Codex shown and no chat', 'none', false, true, 'tasks', 'tasks'],
    ['nothing focused with Codex and a chat', 'none', true, true, 'tasks', 'chat'],
    ['nothing shown', 'none', false, false, 'today', null],
  ];
  for (const [name, focus, chatShown, codexShown, list, expected] of cases) it(name, () => expect(findScope({ focus, chatShown, codexShown, list })).toBe(expected));
});

describe('focusOf', () => {
  stubGlobal('document', { body: {} });
  // An element inside ancestors given as 'class class' or '[role]'; closest handles the selector forms focusOf uses.
  const inside = (...ancestors: string[]) => ({
    closest: (selector: string) => selector.split(',').some((s) => ancestors.some((a) => {
      const role = /^\[role="([a-z]+)"\]$/.exec(s.trim());
      if (role) return a === `[${role[1]}]`;
      const [, cls, not] = /^\.([\w-]+)(?::not\(\.([\w-]+)\))?$/.exec(s.trim())!;
      const own = a.split(' ');
      return own.includes(cls) && !(not && own.includes(not));
    })),
  }) as unknown as Element;

  it('names where focus is', () => {
    expect(focusOf(inside('as-sheet', '[dialog]'))).toBe('modal');
    expect(focusOf(inside('dialog', '[alertdialog]'))).toBe('modal');
    expect(focusOf(inside('cm-editor', 'editor shown'))).toBe('editor');
    expect(focusOf(inside('md', 'editor shown'))).toBe('editor');
    expect(focusOf(inside('as-list', 'assistant', 'editor as-editor shown'))).toBe('codex');
    expect(focusOf(inside('brief'))).toBe('chat');
    expect(focusOf(inside('elsewhere'))).toBe('none');
  });

  it('takes the pane of the last press while focus is on the body', () => {
    const pressed = (on: boolean, ...ancestors: string[]) => Object.assign(inside(...ancestors), { isConnected: on });
    expect(findFocus(document.body, pressed(true, 'as-list', 'assistant'))).toBe('codex');
    expect(findFocus(null, pressed(true, 'brief'))).toBe('chat');
    expect(findFocus(inside('brief'), pressed(true, 'assistant'))).toBe('chat');
    expect(findFocus(document.body, pressed(false, '[dialog]'))).toBe('none');
    expect(findFocus(document.body, null)).toBe('none');
  });
});
