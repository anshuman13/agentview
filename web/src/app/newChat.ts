import type { ClientMessage, Provider, ProviderOption, SessionInfo } from '../../../shared/protocol';
import { save, stored } from '../ui/util';
import { appSettings } from './appSettings';
import { send } from './store/send';

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

export function newChat(msg: Omit<Extract<ClientMessage, { type: 'new_session' }>, 'type'> = {}) {
  if (msg.model) rememberModel(msg.provider, msg.model);
  const wanted = msg.model ?? (msg.fork ? undefined : lastModel(msg.provider) ?? undefined);
  const model = knownModels(msg.provider).some((m) => m.value === wanted) ? wanted : undefined;
  send({ type: 'new_session', ...msg, ...(model && { model }) });
}
