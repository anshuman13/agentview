import { createStore } from '../../ui/createStore';
import { save, stored } from '../../ui/util';
import type { TranscriptView } from './steps';

const KEY = 'agentview.transcriptView';

export const transcriptView = createStore<TranscriptView>(stored<TranscriptView>(KEY, 'normal'));

export function setTranscriptView(v: TranscriptView) {
  save(KEY, v);
  transcriptView.set(v);
}
