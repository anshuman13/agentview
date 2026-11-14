import { gz } from './web.js';
import { readBody } from './body.js';
import { chatFileRoutes, chatMcpRoutes, chatPrefixes, chatSessionRoutes, streamRoutes } from './chatRoutes.js';
import { openPrefixes, sessionRoutes, systemRoutes, workspaceRoutes } from './openRoutes.js';
import { runRoutes } from './runRoutes.js';
import { type Ctx, type Entry, type Prefix, type Reply, type RouteDeps } from './routeTypes.js';

export type { RouteDeps };

const isReply = (v: unknown): v is Reply => typeof v === 'object' && v !== null && 'status' in v && ('body' in v || 'text' in v);

export function writers(req: Request) {
  const jsonText = async (text: string, code = 200) => {
    if (text.length < 1024 || !/\bgzip\b/.test(req.headers.get('accept-encoding') ?? '')) return new Response(text, { status: code, headers: { 'content-type': 'application/json' } });
    return new Response(await gz(text), { status: code, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', vary: 'accept-encoding, origin' } });
  };
  const json = (body: unknown, code = 200) => jsonText(JSON.stringify(body), code);
  return { json, jsonText };
}


function find<C>(table: Record<string, Entry<C>>, prefixes: Prefix<C>[], method: string, path: string) {
  return table[`${method} ${path}`] ?? table[`ANY ${path}`] ?? prefixes.find((p) => path.startsWith(p.prefix));
}

export function createRoutes(d: RouteDeps) {
  const open = { ...sessionRoutes(d), ...workspaceRoutes(d), ...runRoutes(d), ...systemRoutes(d), ...streamRoutes(d) };
  const chatRoutes = { ...chatSessionRoutes(d), ...chatFileRoutes(), ...chatMcpRoutes(d) };

  async function dispatch(req: Request, url: URL, ip: string): Promise<Response> {
    const { json, jsonText } = writers(req);
    const method = req.method;
    try {
      const ctx: Ctx = { req, ip, url, method, body: null };
      const run = async <C extends Ctx>(e: Entry<C>, c: C) => {
        if (e.body === true || e.body === method) c.body = JSON.parse(await readBody(req));
        const out = await e.run(c);
        if (out instanceof Response) return out;
        if (!isReply(out)) return json(out);
        return 'text' in out ? jsonText(out.text, out.status) : json(out.body, out.status);
      };
      const free = find(open, openPrefixes, method, url.pathname);
      if (free) return await run(free, ctx);
      const api = url.pathname.startsWith('/api/');
      const web = () => d.serveWeb(req, url).then((r) => r ?? json({ error: 'web client not built, run bun run dev or bun run build' }, 404));
      // The web app loads while the agent host starts.
      if (!api) return await web();
      const chat = d.chats().get(url.searchParams.get('chat') ?? '') ?? d.chats().get(d.lastViewed());
      if (!chat) return await json({ error: 'The agent host is starting' }, 503);
      const mine = find(chatRoutes, chatPrefixes, method, url.pathname);
      if (mine) return await run(mine, { ...ctx, chat });
      return await json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  return { dispatch };
}
