import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.rsc': 'text/x-component',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg',
};

function within(root: string, target: string) {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Only the generated public export is served, never the repository or server bundle. */
export function staticHandler(directory: string) {
  const root = resolve(directory);
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const fail = (status: number, message: string) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : message);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); fail(405, 'Method not allowed'); return; }
    let path: string;
    try { path = decodeURIComponent((req.url ?? '/').split('?')[0]); }
    catch { fail(400, 'Invalid URL'); return; }
    if (!path.startsWith('/') || path.includes('\\') || path.includes(String.fromCharCode(0)) || path.split('/').some(part => part.startsWith('.'))) { fail(404, 'Not found'); return; }
    let file = resolve(root, `.${path}`);
    if (!within(root, file)) { fail(404, 'Not found'); return; }
    try {
      if (path.endsWith('/')) file = resolve(file, 'index.html');
      const canonicalRoot = await realpath(root), canonicalFile = await realpath(file);
      if (!within(canonicalRoot, canonicalFile)) { fail(404, 'Not found'); return; }
      const info = await stat(canonicalFile);
      if (!info.isFile()) { fail(404, 'Not found'); return; }
      const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
      const hashed = path.startsWith('/_next/static/');
      res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'content-length': info.size });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(canonicalFile);
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      fail(code === 'ENOENT' || code === 'ENOTDIR' ? 404 : 500, code === 'ENOENT' || code === 'ENOTDIR' ? 'Not found' : 'Unable to serve file');
    }
  };
}
