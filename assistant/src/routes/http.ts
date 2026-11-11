import { BadRequest, parseObject, readBody } from '../../../server/src/http/body.js';
import { errText } from '../../../shared/util.js';
import type { openDb } from '../core/db.js';
import { SyncError } from '../core/sync.js';

// What a route answers. The first send settles response, so a route can answer at once and keep working.
export class Reply {
  sent = false;
  readonly response: Promise<Response>;
  private settle!: (r: Response) => void;

  constructor(readonly headers: Record<string, string> = {}) {
    this.response = new Promise((r) => (this.settle = r));
  }

  send(status: number, obj: unknown, headers: Record<string, string> = {}) {
    if (this.sent) return;
    this.sent = true;
    this.settle(new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...this.headers, ...headers } }));
  }
}

export type Ctx = {
  req: Request;
  res: Reply;
  url: URL;
  device: string;
  getDb: () => ReturnType<typeof openDb>;
};

export type Routes = Record<string, (c: Ctx) => unknown>;

export const readJson = async (req: Request, max: number) => parseObject(await readBody(req, max));

export function send(res: Reply, status: number, obj: unknown, headers: Record<string, string> = {}) {
  res.send(status, obj, headers);
}

export function fail(res: Reply, err: unknown) {
  const message = errText(err);
  if (message === 'Request body too large') send(res, 413, { error: message }, { 'Connection': 'close' });
  else if (err instanceof BadRequest || err instanceof SyncError) send(res, 400, { error: message });
  else send(res, 500, { error: 'internal error' });
}

// The JSON body, or null once the error response is sent.
export async function body<T>({ req, res }: Ctx, max: number): Promise<T | null> {
  try {
    return (await readJson(req, max)) as T;
  } catch (err) {
    fail(res, err);
    return null;
  }
}
