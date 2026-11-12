import { describe, expect, it, vi } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { CanUseTool, HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { agentOptions } from './options.js';
import { loadOpenRouter, openRouterEnv, openRouterModels, openRouterValue, openRouterView, saveOpenRouter, type OpenRouterSettings } from './openrouter.js';

const settings: OpenRouterSettings = { key: 'sk-or-test-1234567890', default: 'sonnet', models: { sonnet: 'vendor/model-a', haiku: 'vendor/model-b' } };

const build = (openrouter: OpenRouterSettings | null) =>
  agentOptions({ cwd: '/tmp', host: { setStatus: vi.fn() }, chat: () => null, canUseTool: vi.fn() as unknown as CanUseTool, beforeAgent: vi.fn() as unknown as HookCallback, beforeEdit: vi.fn() as unknown as HookCallback, beforeTool: vi.fn() as unknown as HookCallback, afterTool: vi.fn() as unknown as HookCallback, onStop: vi.fn() as unknown as HookCallback, openrouter });

describe('openrouter', () => {
  it('points the SDK at OpenRouter and gives every slot a model', () => {
    expect(openRouterEnv(settings)).toEqual({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_AUTH_TOKEN: settings.key,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: 'vendor/model-a',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'vendor/model-a',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'vendor/model-a',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'vendor/model-b',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'vendor/model-a',
      CLAUDE_CODE_SUBAGENT_MODEL: 'vendor/model-a',
    });
  });

  it('starts a chat with that env and without the Fable agent, and leaves Claude chats alone', () => {
    const on = build(settings);
    expect(on.env).toMatchObject(openRouterEnv(settings));
    expect(on.agents).toEqual({});
    expect(on.plugins).toBeUndefined();
    const off = build(null);
    expect(off.env?.ANTHROPIC_BASE_URL).toBe(process.env.ANTHROPIC_BASE_URL);
    expect(Object.keys(off.agents ?? {})).toEqual(['big-bro']);
    expect(off.plugins).toEqual([{ type: 'local', path: expect.stringMatching(/server[\\/]build-kit$/), skipMcpDiscovery: true }]);
  });

  it('disallows WebSearch when a slot is not an Anthropic model', () => {
    expect(build(settings).disallowedTools).toContain('WebSearch');
    expect(build({ ...settings, models: { sonnet: 'anthropic/claude-sonnet' } }).disallowedTools).not.toContain('WebSearch');
    expect(build(null).disallowedTools).not.toContain('WebSearch');
  });

  it('lists the saved slots by their OpenRouter id, and nothing without settings', () => {
    expect(openRouterModels(settings).map((m) => [m.value, m.displayName])).toEqual([['openrouter:sonnet', 'vendor/model-a'], ['openrouter:haiku', 'vendor/model-b']]);
    expect(openRouterModels(null)).toEqual([]);
    expect(openRouterValue(settings, 'vendor/model-b')).toBe('openrouter:haiku');
    expect(openRouterValue(settings, 'sonnet')).toBe('openrouter:sonnet');
    expect(openRouterValue(settings, 'other')).toBe('other');
  });

  it('is off without a key or a model, keeps the saved key on an empty one and masks it', async () => {
    expect(loadOpenRouter()).toBeNull();
    await saveOpenRouter({ key: '', models: { sonnet: 'vendor/model-a' } });
    expect(loadOpenRouter()).toBeNull();
    const view = await saveOpenRouter({ key: settings.key, default: 'haiku', models: { sonnet: ' vendor/model-a ', opus: '' } });
    expect(view).toEqual({ hasKey: true, maskedKey: 'sk-or-...7890', default: 'haiku', models: { sonnet: 'vendor/model-a' } });
    expect(loadOpenRouter()).toEqual({ key: settings.key, default: 'sonnet', models: { sonnet: 'vendor/model-a' } });
    await saveOpenRouter({ key: '', models: { sonnet: 'vendor/model-c' } });
    expect(loadOpenRouter()?.key).toBe(settings.key);
    expect(JSON.stringify(openRouterView())).not.toContain(settings.key);
    expect(readFileSync(`${process.env.AGENTVIEW_LIMITS_DIR}/openrouter.json`, 'utf8')).toContain(settings.key);
  });
});
