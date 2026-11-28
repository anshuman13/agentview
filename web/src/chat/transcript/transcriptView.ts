import { createStore } from '../../ui/createStore';
import { save, stored } from '../../ui/util';
import { getState, useStore } from '../../app/store';
import { chatTranscriptView, type TranscriptView } from './steps';

const KEY = 'agentview.transcriptView';
const CHAT_KEY = 'agentview.chatTranscriptViews';

export const transcriptView = createStore<TranscriptView>(stored<TranscriptView>(KEY, 'normal'));
const chatViews = createStore<Record<string, TranscriptView>>(stored<Record<string, TranscriptView>>(CHAT_KEY, {}));

export function setTranscriptView(v: TranscriptView) {
  save(KEY, v);
  transcriptView.set(v);
}

export function setChatTranscriptView(chat: string, v: TranscriptView) {
  const next = { ...chatViews.get(), [chat]: v };
  save(CHAT_KEY, next);
  chatViews.set(next);
}

export function useChatTranscriptView() {
  const chat = useStore((s) => s.session.id);
  return chatTranscriptView(chatViews.use(), chat, transcriptView.use());
}

export const chatTranscriptViewNow = () => chatTranscriptView(chatViews.get(), getState().session.id, transcriptView.get());
