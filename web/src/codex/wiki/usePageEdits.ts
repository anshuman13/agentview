import { useRef } from 'react';
import { useAssistantStore } from '../data';
import { newFact, type Page } from '../data/wiki/wiki';
import { showSnack } from '../view';

export function usePageEdits(page: Page | undefined, pid: string | null, filter: string, back: () => void) {
  const store = useAssistantStore();
  const cancelled = useRef(false);
  const propose = (text: string | undefined) => {
    if (!text || !page) return;
    const fact = newFact(text, pid, pid ? page.profile : filter === 'personal' ? 'personal' : 'work');
    void store.editRow('facts', fact, {});
    showSnack('Claim proposed', () => void store.editRow('facts', fact, { deleted: 1 }));
  };
  const rename = (title: string | undefined) => {
    if (cancelled.current) return;
    cancelled.current = true;
    if (!title || !page || title === page.title) return;
    const prev = page.title;
    void store.editRow('pages', page, { title });
    showSnack('Renamed', () => void store.editRow('pages', page, { title: prev }));
  };
  const archive = () => {
    if (!page) return;
    void store.editRow('pages', page, { state: 'retired' });
    showSnack(`Archived ${page.title}`, () => void store.editRow('pages', page, { state: null }));
    back();
  };
  return { cancelled, propose, rename, archive };
}
