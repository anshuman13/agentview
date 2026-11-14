import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants as zlib } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../../web/dist');
const DEV_WEB = process.env.AGENTVIEW_DEV_WEB;

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

// Compressed copies of web/dist files, made once per file version.
const packed = new Map<string, { mtime: number; packing: Promise<{ br: Buffer; gzip: Buffer }> }>();
const brotli = promisify(brotliCompress);
export const gz = promisify(gzip);
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest', '.ttf']);

async function compressed(file: string, body: Buffer, mtime: number) {
  const hit = packed.get(file);
  if (hit?.mtime === mtime) return hit.packing;
  // Requests that come while it compresses share the one compression.
  const packing = Promise.all([brotli(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }), gz(body, { level: 9 })]).then(([br, gzip]) => ({ br, gzip }));
  packed.set(file, { mtime, packing });
  packing.catch(() => packed.get(file)?.packing === packing && packed.delete(file));
  return packing;
}

const bytes = (b: Buffer) => new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.length);

// Serves web/dist, or redirects to the dev server; null when there is no build.
export async function serveWeb(req: Request, url: URL) {
  if (DEV_WEB) return new Response(null, { status: 302, headers: { location: `http://${new URL(`http://${req.headers.get('host') ?? 'localhost'}`).hostname}:${DEV_WEB}${url.pathname}${url.search}` } });
  let file = path.join(WEB_DIST, url.pathname === '/' ? 'index.html' : url.pathname);
  let info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    file = path.join(WEB_DIST, 'index.html');
    info = await stat(file).catch(() => null);
  }
  const body = info && (await readFile(file).catch(() => null));
  if (!info || !body) return null;
  const ext = path.extname(file);
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Vite puts a content hash in every file name under assets/, so those never change.
    'cache-control': file.startsWith(path.join(WEB_DIST, 'assets') + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(COMPRESS.has(ext) && { vary: 'accept-encoding' }),
  };
  const accept = req.headers.get('accept-encoding') ?? '';
  const encoding = !COMPRESS.has(ext) || body.length < 1024 ? null : /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
  if (!encoding) return new Response(bytes(body), { headers });
  const out = (await compressed(file, body, info.mtimeMs))[encoding];
  return new Response(bytes(out), { headers: { ...headers, 'content-encoding': encoding } });
}
