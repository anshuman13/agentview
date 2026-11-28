import { createStore } from '../../ui/createStore';
import { save, stored } from '../../ui/util';

export type TranscriptWidth = 'narrow' | 'wide';
export const TRANSCRIPT_WIDTHS: TranscriptWidth[] = ['narrow', 'wide'];

const KEY = 'agentview.transcriptWidth';

export const transcriptWidth = createStore<TranscriptWidth>(stored<TranscriptWidth>(KEY, 'narrow'));

function apply(w: TranscriptWidth) {
  if (typeof document !== 'undefined') document.documentElement?.style?.setProperty?.('--tr-width', w === 'wide' ? '140ch' : '90ch');
}
apply(transcriptWidth.get());

export function setTranscriptWidth(w: TranscriptWidth) {
  save(KEY, w);
  transcriptWidth.set(w);
  apply(w);
}
