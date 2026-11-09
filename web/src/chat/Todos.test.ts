import { describe, expect, it } from 'vitest';
import { todoPrompt } from './Todos';

describe('todoPrompt', () => {
  it('asks to do, answer or resolve by comment kind', () => {
    expect(todoPrompt({ path: 'a.ts', line: 3, text: 'cache it', ai: '!' })).toMatch(/^Do what the AI! comment at a\.ts:3 asks \("cache it"\)/);
    expect(todoPrompt({ path: 'a.ts', line: 3, text: 'why?', ai: '?' })).toMatch(/change nothing\.$/);
    expect(todoPrompt({ path: 'a.ts', line: 3 })).toMatch(/^Resolve the TODO at a\.ts:3\. Read/);
  });
});
