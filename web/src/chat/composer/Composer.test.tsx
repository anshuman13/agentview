import { describe, expect, it, vi } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { stubGlobal } from '../../../../testing';

const draft = { text: '' };

const react = createRequire(import.meta.url)('react') as typeof import('react');
const { useSyncExternalStore } = react;
vi.mock('react', () => ({ ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => useSyncExternalStore(subscribe, get, get) }));
vi.mock('../../app/shell/useNarrow', () => ({ useNarrow: () => true }));
const promptHistory = await import('./usePromptHistory');
vi.mock('./usePromptHistory', () => ({ ...promptHistory, useDraft: () => [draft.text, () => {}] }));

const { Composer } = await import('./Composer');

stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
stubGlobal('window', { SpeechRecognition: class {} });

describe('Composer at phone width', () => {
  it('has Add and a mic with no foot row while empty, and Send in place of the mic once typed', () => {
    draft.text = '';
    const empty = renderToStaticMarkup(<Composer />);
    expect(empty).toContain('aria-label="Add"');
    expect(empty).toContain('aria-label="Dictate"');
    expect(empty).not.toContain('cp-foot');
    draft.text = 'hello';
    const typed = renderToStaticMarkup(<Composer />);
    expect(typed).toContain('aria-label="Send"');
    expect(typed).not.toContain('aria-label="Dictate"');
  });
});
