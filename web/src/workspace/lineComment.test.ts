import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { commentChip, commentLabel, commentPrompt, withComments, type LineComment } from '../../../shared/lineComment';
import { commentField, lineComments, setComment, stageComment } from './lineComment';

const c: LineComment = { path: 'src/calc.py', line: 5, code: 'def subtract(a, b):', text: 'Add a one-line docstring here' };

describe('line comments', () => {
  test('chip, prompt and label', () => {
    expect(commentChip(c)).toBe('calc.py:5 Add a one-line docstring here');
    expect(commentPrompt(c)).toBe('Comment on `src/calc.py:5` (`def subtract(a, b):`): Add a one-line docstring here');
    expect(commentPrompt({ ...c, code: '  ' })).toBe('Comment on `src/calc.py:5`: Add a one-line docstring here');
    expect(commentLabel(5, false)).toBe('Line 5');
    expect(commentLabel(5, true)).toBe('Line 5 · Added to prompt');
  });

  test('comments follow the typed text', () => {
    expect(withComments(' fix it ', [c])).toBe(`fix it\n\n${commentPrompt(c)}`);
    expect(withComments('', [c, { ...c, line: 6 }]).split('\n\n')).toHaveLength(2);
    expect(withComments('hi', [])).toBe('hi');
  });

  test('the open box is staged with its line and text', () => {
    let state = EditorState.create({ doc: 'a\nb\nc', extensions: lineComments('x.ts') });
    expect(state.field(commentField)).toBeNull();
    state = state.update({ effects: setComment.of({ line: 2, text: '', staged: false }) }).state;
    expect(state.field(commentField)).toEqual({ line: 2, text: '', staged: false });
    expect(stageComment('x.ts', state, { line: 2, text: '  ', staged: false })).toBeNull();
    expect(stageComment('x.ts', state, { line: 9, text: 'hi', staged: false })).toBeNull();
    expect(stageComment('x.ts', state, { line: 2, text: ' rename ', staged: false })).toEqual({ path: 'x.ts', line: 2, code: 'b', text: 'rename' });
    state = state.update({ effects: setComment.of(null) }).state;
    expect(state.field(commentField)).toBeNull();
  });
});
