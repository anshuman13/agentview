import type { z } from 'zod';
import type { Provider } from '../../../../shared/protocol.js';
import type { AgentHost } from '../types.js';

// What a tool call runs against: the chat's folder, its session id and the session that reports what the tool did.
export type ToolCtx = { cwd: string; chatId: string | null; provider: Provider; host: Pick<AgentHost, 'setStatus'> };

export type Tool<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  schema: S;
  handler(args: z.infer<z.ZodObject<S>>, ctx: ToolCtx): Promise<string>;
};

export const defineTool = <S extends z.ZodRawShape>(t: Tool<S>) => t;
