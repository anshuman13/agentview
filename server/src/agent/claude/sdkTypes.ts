import type { HookInput, HookJSONOutput, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export type { HookInput, HookJSONOutput };
export type SystemMessage = Extract<SDKMessage, { type: 'system' }>;
export type AssistantMessage = Extract<SDKMessage, { type: 'assistant' }>;
export type UserMessage = Extract<SDKMessage, { type: 'user' }>;
export type ToolResultBlock = Extract<Exclude<UserMessage['message']['content'], string>[number], { type: 'tool_result' }>;
