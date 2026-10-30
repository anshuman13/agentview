import type http from 'node:http';
import { BadRequest, parseObject, readBody } from '../../../server/src/http/body.js';
import type { openDb } from '../db.js';
import { SyncError } from '../sync.js';

export type Ctx = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  device: string;
  getDb: () => ReturnType<typeof openDb>;
};

export type Routes = Record<string, (c: Ctx) => unknown>;

export const readJson = async (req: http.IncomingMessage, max: number) => parseObject(await readBody(req, max));

export function send(res: http.ServerResponse, status: number, obj: unknown, headers: http.OutgoingHttpHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

export function fail(res: http.ServerResponse, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'Request body too large') send(res, 413, { error: message }, { 'Connection': 'close' });
  else if (err instanceof BadRequest || err instanceof SyncError) send(res, 400, { error: message });
  else send(res, 500, { error: 'internal error' });
}
