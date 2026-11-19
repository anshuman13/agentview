import { describe, expect, test } from 'bun:test';
import { docAskPrompt, replaceBlock } from './docEdit';

describe('docEdit', () => {
  test('replaces a block and keeps the blank lines after it', () => {
    const text = '# T\n\nOld para\nline 2\n\n- a\n';
    const start = text.indexOf('Old');
    expect(replaceBlock(text, { start, raw: 'Old para\nline 2\n\n' }, 'New para\n\n\n')).toBe('# T\n\nNew para\n\n- a\n');
    expect(replaceBlock(text, { start, raw: 'Old para\nline 2' }, 'New\n')).toBe('# T\n\nNew\n\n- a\n');
    expect(replaceBlock(text, { start: start + 1, raw: 'Old para\nline 2\n\n' }, 'x')).toBeNull();
  });

  test('quotes the selection in the prompt', () => {
    expect(docAskPrompt('notes/a.md', ' one\ntwo ', 'shorter ')).toBe('In notes/a.md, about this part:\n\n> one\n> two\n\nshorter\n\nEdit the file in place and leave the rest as it is.');
  });
});
