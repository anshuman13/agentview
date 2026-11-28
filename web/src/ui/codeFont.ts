import { createStore } from './createStore';
import { save, stored } from './util';

export const CODE_FONT_SIZES = [11, 12, 13, 14, 15, 16];

const KEY = 'agentview.codeFontSize';

export const codeFontSize = createStore<number>(stored<number>(KEY, 13));

function apply(px: number) {
  if (typeof document !== 'undefined') document.documentElement?.style?.setProperty?.('--code-fs', `${px}px`);
}
apply(codeFontSize.get());

export function setCodeFontSize(px: number) {
  save(KEY, px);
  codeFontSize.set(px);
  apply(px);
}
