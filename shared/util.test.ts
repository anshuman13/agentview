import { describe, expect, it } from 'bun:test';
import { chatTitle } from './util';

describe('chatTitle', () => {
  it('strips the leading mentions of the first line', () => {
    expect(chatTitle('@chat:3f2a also check the importer')).toBe('also check the importer');
    expect(chatTitle('@src/app/store.ts @chat:3f2a fix the bug\nmore')).toBe('fix the bug');
    expect(chatTitle('fix @src/a.ts now')).toBe('fix @src/a.ts now');
  });
  it('falls to the next non-empty line, then a name', () => {
    expect(chatTitle('@src/app/store.ts\n\nfix the bug')).toBe('fix the bug');
    expect(chatTitle('@src/app/store.ts')).toBe('About store.ts');
    expect(chatTitle('@chat:3f2a\n  ')).toBe('Follow-up chat');
  });
  it('does not treat an address as a mention', () => {
    expect(chatTitle('email@me hello')).toBe('email@me hello');
  });
  it('cuts the title to 80 characters', () => {
    expect(chatTitle(`@chat:1 ${'x'.repeat(100)}`)).toHaveLength(80);
    expect(chatTitle('y'.repeat(100))).toHaveLength(80);
  });
});
