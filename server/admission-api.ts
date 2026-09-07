import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AdmissionQueue } from './admission.ts';

export function admissionApi(options: {
  admission: AdmissionQueue;
  counts: () => { queued: number; inGame: number; legacyOnline: number };
  originAllowed: (req: IncomingMessage) => boolean;
  cancel: (ticket: string) => void;
  now?: () => number;
  visitorTtlMs?: number;
}) {
  const visitors = new Map<string, number>();
  const now = options.now ?? Date.now;
  const ttl = options.visitorTtlMs ?? 45000;
  const validVisitor = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(id);
  const visit = (id: string) => {
    if (visitors.has(id) || visitors.size < 50000) visitors.set(id, now());
  };
  const sweep = () => {
    options.admission.sweep();
    for (const [id, seen] of visitors) if (now() - seen >= ttl) visitors.delete(id);
  };
  const stats = () => {
    const { queued, inGame, legacyOnline } = options.counts();
    return { online: visitors.size + legacyOnline, queued, inGame, ...options.admission.stats() };
  };
  const reply = (res: ServerResponse, status: number, value: object) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET' && req.url === '/presence' && !req.headers.origin) { reply(res, 200, { type: 'presence', ...stats() }); return; }
    if (!options.originAllowed(req)) { reply(res, 403, { type: 'error', message: 'Origin is not allowed.' }); return; }
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'GET' && req.url === '/presence') { reply(res, 200, { type: 'presence', ...stats() }); return; }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      res.writeHead(204); res.end(); return;
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); reply(res, 405, { type: 'error', message: 'Method not allowed.' }); return; }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) { reply(res, 415, { type: 'error', message: 'Expected JSON.' }); req.resume(); return; }
    let body: Record<string, unknown>;
    try { body = await readJson(req); }
    catch (error) { res.setHeader('Connection', 'close'); reply(res, error instanceof RangeError ? 413 : 400, { type: 'error', message: 'Invalid request body.' }); return; }
    if (req.url === '/presence') {
      if (!validVisitor(body.visitorId)) { reply(res, 400, { type: 'error', message: 'Invalid visitor ID.' }); return; }
      visit(body.visitorId); reply(res, 200, { type: 'presence', ...stats() }); return;
    }
    if (body.action === 'join') {
      if (!validVisitor(body.visitorId)) { reply(res, 400, { type: 'error', message: 'Invalid visitor ID.' }); return; }
      visit(body.visitorId);
      const ticket = options.admission.join(body.visitorId);
      if (!ticket) { res.setHeader('Retry-After', '10'); reply(res, 503, { type: 'error', message: 'The waiting room is full. Please try again shortly.' }); return; }
      reply(res, 200, { type: 'admission', ...ticket, retryAfterMs: 2500, ...stats() }); return;
    }
    if (typeof body.ticket !== 'string' || !/^[a-zA-Z0-9_-]{32}$/.test(body.ticket)) { reply(res, 400, { type: 'error', message: 'Invalid ticket.' }); return; }
    if (body.action === 'cancel') {
      options.cancel(body.ticket);
      reply(res, 200, { type: 'admission', status: 'cancelled', ...stats() }); return;
    }
    if (body.action === 'poll') {
      const ticket = options.admission.poll(body.ticket);
      if (!ticket) { reply(res, 404, { type: 'error', message: 'Your waiting room ticket has expired.' }); return; }
      reply(res, 200, { type: 'admission', ...ticket, retryAfterMs: 2500, ...stats() }); return;
    }
    reply(res, 400, { type: 'error', message: 'Unknown admission action.' });
  }
  return { handle, stats, sweep };
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0, done = false;
    const chunks: Buffer[] = [];
    const fail = (error: Error) => { if (!done) { done = true; req.setTimeout(0); reject(error); } };
    req.setTimeout(5000, () => { fail(new Error('Body timed out')); req.destroy(); });
    req.on('data', (part: Buffer) => {
      if (done) return;
      size += part.length;
      if (size > 2048) { chunks.length = 0; fail(new RangeError('Body too large')); return; }
      chunks.push(part);
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new Error('Request aborted')));
    req.on('end', () => {
      if (done) return;
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body');
        done = true; req.setTimeout(0); resolve(value as Record<string, unknown>);
      } catch { fail(new Error('Invalid JSON')); }
    });
  });
}
