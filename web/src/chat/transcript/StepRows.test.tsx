import { describe, expect, it, vi } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';

const react = createRequire(import.meta.url)('react') as typeof import('react');
const { useSyncExternalStore } = react;
vi.mock('react', () => ({ ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => useSyncExternalStore(subscribe, get, get) }));

const { Detail, Step } = await import('./StepRows');

const use = { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' }, at: 1 } as never;
const html = (text: string) => renderToStaticMarkup(<Detail use={use} result={{ kind: 'tool_result', id: 't1', text, isError: false, at: 2 } as never} />);

describe('tool output copy', () => {
  it('shows a copy button on output, none when there is no output', () => {
    expect(html('a.txt')).toContain('aria-label="Copy output"');
    expect(html('')).not.toContain('Copy output');
    expect(html('')).toContain('(no output)');
  });
});

describe('ship steps', () => {
  it('names a PR step and links the PR', () => {
    const pr = { kind: 'tool_use', id: 't2', name: 'Bash', input: { command: 'gh pr create --fill', description: 'Open the PR' }, at: 1 } as never;
    const out = renderToStaticMarkup(<Step use={pr} result={{ kind: 'tool_result', id: 'r2', toolUseId: 't2', text: 'https://github.com/o/r/pull/6', isError: false, at: 2 } as never} cwd="" />);
    expect(out).toContain('Created </span><a class="tr-obj" href="https://github.com/o/r/pull/6"');
    expect(out).toContain('PR #6</a>');
  });
});
