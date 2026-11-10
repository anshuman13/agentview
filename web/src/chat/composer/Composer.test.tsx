import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Composer } from './Composer';

const draft = vi.hoisted(() => ({ text: '' }));

vi.mock('../../app/shell/useNarrow', () => ({ useNarrow: () => true }));
vi.mock('./usePromptHistory', async (importOriginal) => ({ ...(await importOriginal<object>()), useDraft: () => [draft.text, () => {}] }));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => react.useSyncExternalStore(subscribe, get, get) };
});

vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
vi.stubGlobal('window', { SpeechRecognition: class {} });

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
