import { describe, expect, it } from 'bun:test';
import { ariaKeys, keyText } from './keys';

describe('keyText', () => {
  it('keeps the Mac glyphs on a Mac and spells the modifiers out elsewhere, Ctrl first', () => {
    expect(keyText('⇧⌘P or F1', true)).toBe('⇧⌘P or F1');
    expect(keyText('⌘B', false)).toBe('Ctrl+B');
    expect(keyText('⌥⌘B', false)).toBe('Ctrl+Alt+B');
    expect(keyText('⇧⌘] / ⇧⌘[', false)).toBe('Ctrl+Shift+] / Ctrl+Shift+[');
    expect(keyText('?', false)).toBe('?');
  });
});

describe('ariaKeys', () => {
  it('names the modifiers for the platform', () => {
    expect(ariaKeys('⇧⌘P', true)).toBe('Meta+Shift+P');
    expect(ariaKeys('⇧⌘P', false)).toBe('Control+Shift+P');
    expect(ariaKeys('⌥⌘B', true)).toBe('Meta+Alt+B');
    expect(ariaKeys('⌘;', false)).toBe('Control+;');
    expect(ariaKeys('⌘Enter', true)).toBe('Meta+Enter');
  });
});
