// OpenRouter models stand in for Claude's model names: a slot is the Claude alias the CLI asks for, the id is the OpenRouter model behind it.
export const MODEL_SLOTS = ['opus', 'sonnet', 'haiku', 'fable'] as const;
export type ModelSlot = (typeof MODEL_SLOTS)[number];

export const OPENROUTER_PREFIX = 'openrouter:';

export type OpenRouterModels = Partial<Record<ModelSlot, string>>;

// What the Models settings show: the key is never sent back.
export type OpenRouterView = { hasKey: boolean; maskedKey: string; default: ModelSlot; models: OpenRouterModels };

export const maskKey = (key: string) => (key ? `${key.slice(0, 6)}...${key.slice(-4)}` : '');
