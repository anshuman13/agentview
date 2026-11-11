import { describe, expect, it } from 'bun:test';
import { planFeedback, planParagraphs } from './Pending';
import { lineDiff } from '../../../../shared/lineDiff';

describe('lineDiff', () => {
  it('keeps shared lines and puts removals before additions', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toEqual([[' ', 'a'], ['-', 'b'], ['+', 'B'], [' ', 'c']]);
  });
});

describe('plan comments', () => {
  it('splits at blank lines but keeps a fenced block whole', () => {
    expect(planParagraphs('# Plan\n\n1. Add a route\n2. Test it\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nDone')).toEqual(['# Plan', '1. Add a route\n2. Test it', '```ts\nconst a = 1;\n\nconst b = 2;\n```', 'Done']);
  });

  it('quotes each commented paragraph in one message', () => {
    const paras = ['First step', `Second ${'x'.repeat(100)}`, 'Third'];
    const text = planFeedback(paras, { 0: ' use a worktree ', 1: 'too big', 2: '  ' });
    expect(text).toBe(`Comments on the plan:\n\n> First step\nuse a worktree\n\n> Second ${'x'.repeat(73)}…\ntoo big`);
    expect(planFeedback(paras, {})).toBe('');
  });
});
