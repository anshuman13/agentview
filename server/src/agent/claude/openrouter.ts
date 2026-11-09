import path from 'node:path';
import { MODEL_SLOTS, OPENROUTER_PREFIX, maskKey, type ModelSlot, type OpenRouterModels, type OpenRouterView } from '../../../../shared/openrouter.js';
import { readJsonSync, writeJson } from '../../json.js';
import { STATE_DIR } from './accounts.js';

const FILE = path.join(STATE_DIR, 'openrouter.json');

export type OpenRouterSettings = { key: string; default: ModelSlot; models: OpenRouterModels };

const isSlot = (v: unknown): v is ModelSlot => MODEL_SLOTS.includes(v as ModelSlot);

// The settings once a key and at least one model are saved; without them OpenRouter is not offered.
export function loadOpenRouter(): OpenRouterSettings | null {
  const raw = readJsonSync<Partial<OpenRouterSettings> | null>(FILE, null);
  const models = Object.fromEntries(MODEL_SLOTS.flatMap((s) => (raw?.models?.[s] ? [[s, raw.models[s]]] : []))) as OpenRouterModels;
  const first = MODEL_SLOTS.find((s) => models[s]);
  if (!raw?.key || !first) return null;
  return { key: raw.key, default: isSlot(raw.default) && models[raw.default] ? raw.default : first, models };
}

export function openRouterView(): OpenRouterView {
  const raw = readJsonSync<Partial<OpenRouterSettings> | null>(FILE, null);
  return { hasKey: Boolean(raw?.key), maskedKey: maskKey(raw?.key ?? ''), default: isSlot(raw?.default) ? raw.default : 'sonnet', models: raw?.models ?? {} };
}

// An empty key keeps the saved one, so the masked field can be saved without retyping it.
export async function saveOpenRouter(body: { key?: unknown; default?: unknown; models?: unknown }) {
  const old = readJsonSync<Partial<OpenRouterSettings> | null>(FILE, null);
  const given = typeof body.key === 'string' ? body.key.trim() : '';
  const models = body.models && typeof body.models === 'object' ? (body.models as Record<string, unknown>) : {};
  const next: OpenRouterSettings = {
    key: given || old?.key || '',
    default: isSlot(body.default) ? body.default : old?.default ?? 'sonnet',
    models: Object.fromEntries(MODEL_SLOTS.flatMap((s) => (typeof models[s] === 'string' && models[s].trim() ? [[s, models[s].trim()]] : []))),
  };
  await writeJson(FILE, next, { pretty: true, mode: 0o600 });
  return openRouterView();
}

// Every slot gets a model, so a Claude alias the CLI asks for always reaches an OpenRouter model.
export function openRouterEnv(s: OpenRouterSettings): Record<string, string> {
  const main = s.models[s.default]!;
  const slot = (n: ModelSlot) => s.models[n] ?? main;
  return {
    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    ANTHROPIC_AUTH_TOKEN: s.key,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: main,
    ANTHROPIC_DEFAULT_OPUS_MODEL: slot('opus'),
    ANTHROPIC_DEFAULT_SONNET_MODEL: slot('sonnet'),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: slot('haiku'),
    ANTHROPIC_DEFAULT_FABLE_MODEL: slot('fable'),
    CLAUDE_CODE_SUBAGENT_MODEL: main,
  };
}

// The model picker entries: the saved slots, labelled by their OpenRouter id.
export const openRouterModels = (s: OpenRouterSettings | null) =>
  s ? MODEL_SLOTS.flatMap((n) => (s.models[n] ? [{ value: OPENROUTER_PREFIX + n, displayName: s.models[n]!, description: 'OpenRouter' }] : [])) : [];

// The picker value for the model a CLI on OpenRouter reports, which is a slot's alias or its OpenRouter id.
export const openRouterValue = (s: OpenRouterSettings, model: string) => {
  const slot = MODEL_SLOTS.find((n) => n === model || s.models[n] === model);
  return slot ? OPENROUTER_PREFIX + slot : model;
};
