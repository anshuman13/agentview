import type os from 'node:os';
import type { ChatRun, ClientMessage, LiveChat } from '../../../shared/protocol.js';
import type { Host } from '../host/client.js';
import type { Client } from './clients.js';
import type { Sources } from '../integrations/attention.js';

export type RouteDeps = {
  host: Pick<Host, 'notify' | 'req'>;
  chats: () => Map<string, LiveChat>;
  runs: () => ChatRun[];
  lastViewed: () => string;
  bySession: (sessionId: string | null) => string | undefined;
  closeByUser: (id: string) => Promise<void>;
  restart: (now: boolean, full: boolean) => void;
  streams: { get: (cid: string) => Client | undefined };
  handleCommand: (client: Client, msg: ClientMessage, target?: string) => void;
  openEvents: (req: Request, url: URL, chat: string, found?: boolean) => Response;
  attentionSources: (extra?: string[]) => Sources;
  serveWeb: (req: Request, url: URL) => Promise<Response | null>;
  allowedPeer: (addr?: string) => boolean;
  thisMac: string;
  networkInterfaces: typeof os.networkInterfaces;
  PORT: number;
  APK: string;
};

// ip: the address the request comes from, as requester() works it out.
export type Ctx = { req: Request; ip: string; url: URL; method: string; body: any };
export type ChatCtx = Ctx & { chat: LiveChat };
export type Reply = { status: number; body: unknown } | { status: number; text: string };
export type Entry<C> = { run: (c: C) => unknown; body?: boolean | string };
export type Prefix<C> = Entry<C> & { prefix: string };
export const entry = <C>(run: Entry<C>['run'], body?: Entry<C>['body']): Entry<C> => ({ run, body });

// The chat a request names with ?chat, or the one last viewed.
export const currentChat = (d: Pick<RouteDeps, 'chats' | 'lastViewed'>, url: URL) => d.chats().get(url.searchParams.get('chat') ?? '') ?? d.chats().get(d.lastViewed());
