import { useAssistantStore } from '../data';
import { sourcesOf, type Fact } from '../data/wiki/wiki';
import { copyText, showSnack } from '../view';
import { shortDate } from './shared';

export function useClaimEdits(fact: Fact, page: string) {
  const store = useAssistantStore();
  const edit = (patch: Partial<Fact>, undo: Partial<Fact>, done: string) => {
    void store.editRow('facts', fact, patch);
    showSnack(done, () => void store.editRow('facts', fact, undo));
  };
  return {
    save: (next: string) => edit({ text: next }, { text: fact.text }, 'Claim updated'),
    contest: (note: string) => edit({ contested: JSON.stringify({ by: 'you', at: Date.now(), note: note.trim() }) }, { contested: null }, 'Claim contested'),
    resolve: () => edit({ contested: null }, { contested: fact.contested }, 'Marked as resolved'),
    confirm: () => edit({ at: Date.now() }, { at: fact.at }, 'Claim confirmed'),
    retire: () => edit({ state: 'retired' }, { state: null }, 'Claim retired'),
    restore: () => edit({ state: null }, { state: 'retired' }, 'Claim restored'),
    cite: () => {
      const srcs = sourcesOf(fact).map((s) => s.label);
      copyText(`${page}: ${fact.text}${srcs.length ? ` (${srcs.join(', ')}${fact.at ? `, ${shortDate(fact.at)}` : ''})` : ''}`, 'Claim copied');
    },
  };
}
