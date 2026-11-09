import type { KeyboardEvent } from 'react';
import { send } from '../../app/store';
import { touch } from '../../app/touch/touch';
import { PERMISSION_MODES } from '../../../../shared/protocol';
import { accept } from './composerLogic';
import type { useAutocomplete } from './useAutocomplete';
import type { usePromptHistory } from './usePromptHistory';

type Input = {
  text: string;
  mode: string;
  ghost: string;
  ac: ReturnType<typeof useAutocomplete>;
  h: ReturnType<typeof usePromptHistory>;
  apply: (next: string, caret?: number) => void;
  submit: (stop: boolean) => void;
};

export function useComposerKeys({ text, mode, ghost, ac, h, apply, submit }: Input) {
  const choose = (i: number) => {
    if (!ac.trigger || ac.trigger.kind === 'shell' || !ac.items[i]) return;
    const it = ac.items[i].item;
    const value = ac.trigger.kind === 'command' ? `/${(it as { name: string }).name}` : typeof it === 'object' && 'sessionId' in it ? `@chat:${it.sessionId}` : `@${it as string}`;
    const r = accept(text, ac.trigger.start, ac.at, value);
    apply(r.text, r.caret);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const onEntry = h.hist !== null && text === h.hist.list[h.hist.index];
    if (ac.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); ac.setSel((i) => (i + 1) % ac.items.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); ac.setSel((i) => (i - 1 + ac.items.length) % ac.items.length); return; }
      if (e.key === 'Escape') { e.preventDefault(); ac.setDismissed(ac.popKey); return; }
      const exact = ac.trigger?.kind === 'command' && (ac.items[ac.sel]?.item as { name: string } | undefined)?.name === ac.trigger.query;
      if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey && !exact)) { e.preventDefault(); choose(ac.sel); return; }
    }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); send({ type: 'set_permission_mode', mode: PERMISSION_MODES[(PERMISSION_MODES.indexOf(mode as never) + 1) % PERMISSION_MODES.length] }); return; }
    if (ghost && (e.key === 'Tab' || e.key === 'ArrowRight') && el.selectionStart === text.length) { e.preventDefault(); apply(text + ghost); return; }
    if (e.key === 'ArrowUp' && (text === '' || onEntry) && !text.slice(0, el.selectionStart).includes('\n')) { e.preventDefault(); h.step(1, text, apply); return; }
    if (e.key === 'ArrowDown' && onEntry && !text.slice(el.selectionEnd).includes('\n')) { e.preventDefault(); h.step(-1, text, apply); return; }
    if (e.key === 'Enter' && !e.shiftKey && (!touch() || e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(e.metaKey || e.ctrlKey); }
  };

  return { choose, onKeyDown };
}
