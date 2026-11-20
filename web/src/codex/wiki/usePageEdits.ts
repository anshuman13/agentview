import { useRef } from 'react';
import { useAssistantStore } from '../data';
import { memoryClaim, newFact, saveMemoryClaim, type Page } from '../data/wiki/wiki';
import { showSnack } from '../view';

export function usePageEdits(page: Page | undefined, pid: string | null, filter: string, back: () => void) {
  const store = useAssistantStore();
  const cancelled = useRef(false);
  const profile = filter === 'personal' ? 'personal' : 'work';
  const propose = (text: string | undefined) => {
    if (!text || !page) return;
    const fact = newFact(text, pid, pid ? page.profile : profile);
    void store.editRow('facts', fact, {});
    showSnack('Claim proposed', () => void store.editRow('facts', fact, { deleted: 1 }));
  };
  const remember = (text: string | undefined) => {
    const fact = memoryClaim(text ?? '', profile);
    if (!fact) return;
    const { replaced, undo } = saveMemoryClaim(store, fact);
    showSnack(replaced ? 'Saved to Memory, replacing a similar claim' : 'Saved to Memory', undo);
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
  return { cancelled, propose, remember, rename, archive };
}
