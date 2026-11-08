import { errText } from '../../../shared/util.js';

type Settable = { setModel(model: string): Promise<unknown>; system(text: string): void };

// Applies a model chosen on the new chat sheet through the same path as set_model.
export function applyInitialModel(chat: Settable, model: unknown) {
  if (typeof model !== 'string' || !model.trim()) return;
  chat.setModel(model.trim()).catch((err) => chat.system(`Could not set the model: ${errText(err)}`));
}
