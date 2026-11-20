import type { ClientMessage, Provider, ProviderOption, SavedSession, SessionInfo } from '../../../shared/protocol';
import { startModeFor, startTexts, type StartMode } from '../../../shared/providers';
import { save, stored } from '../ui/util';
import { appSettings } from './appSettings';
import { getState, notice, subscribe } from './store/core';
import { prompt, send } from './store/send';

type Models = SessionInfo['models'];

// The server's model set of a provider (Claude and OpenRouter share one), as in Android modelGroup.
export const modelGroup = (provider: Provider | undefined, options: ProviderOption[]) => options.find((o) => o.id === provider)?.modelSet ?? provider ?? 'claude';

const keys = (provider?: Provider) => {
  const g = modelGroup(provider ?? appSettings.get().defaultProvider, appSettings.get().providers);
  const suffix = g === 'claude' ? '' : `:${g}`;
  return { last: `lastModel${suffix}`, list: `models${suffix}` };
};

export const lastModel = (provider?: Provider) => stored<string | null>(keys(provider).last, null);
export const rememberModel = (provider: Provider | undefined, model: string) => save(keys(provider).last, model);
export const knownModels = (provider?: Provider) => stored<Models>(keys(provider).list, []);
export const rememberModels = (provider: Provider | undefined, models: Models) => { if (models.length) save(keys(provider).list, models); };

// The model a new chat starts on: the last one used, sent only when the provider's own list has it, so a Codex id never reaches a Claude chat or the reverse.
export const startModel = (provider?: Provider) => {
  const last = lastModel(provider);
  return knownModels(provider).some((m) => m.value === last) ? last ?? undefined : undefined;
};

type NewSession = Omit<Extract<ClientMessage, { type: 'new_session' }>, 'type'>;

export function newChat(msg: NewSession = {}) {
  if (msg.model) rememberModel(msg.provider, msg.model);
  const wanted = msg.model ?? (msg.fork ? undefined : lastModel(msg.provider) ?? undefined);
  const model = knownModels(msg.provider).some((m) => m.value === wanted) ? wanted : undefined;
  send({ type: 'new_session', ...msg, ...(model && { model }) });
}

// A chat from the New chat sheet (Android Hub.newChat): the start mode is set once the chat is in view, then Spec puts the spec prompt in the composer and the others send the first text.
export function startChat({ text, ...msg }: NewSession, start: StartMode) {
  const { draft, first } = startTexts(start, text);
  const mode = startModeFor(start.mode, msg.provider);
  if (!mode) return newChat({ ...msg, text: first ?? undefined });
  const from = getState().session.id;
  newChat(msg);
  const stop = subscribe(() => {
    const now = getState().session.id;
    if (!now || now === from) return;
    stop();
    send({ type: 'set_permission_mode', mode });
    // After the composer has loaded the new chat's draft, so the insert is not overwritten.
    if (draft) setTimeout(() => window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: draft } })));
    if (first) prompt(first, () => notice('The message was not sent'));
  });
  setTimeout(stop, 30_000);
}

// The saved chats of a repo that are not open, newest first, for the Continue section of the New chat sheet (Android recentInRepo).
export const recentInRepo = (saved: SavedSession[], openIds: (string | null)[], cwd: string | undefined, n = 3) =>
  saved.filter((s) => s.cwd === cwd && !openIds.includes(s.sessionId)).sort((a, b) => b.lastModified - a.lastModified).slice(0, n);
