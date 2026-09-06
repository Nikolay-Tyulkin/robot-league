import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.ts';

const project = process.cwd();

async function tempFixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'robot-league-http-fixture-'));
  t.after(async () => {
    const root = resolve(tmpdir()), child = resolve(dir), rel = relative(root, child);
    assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    await rm(child, { recursive: true, force: true });
  });
  const publicDir = join(dir, 'public');
  await mkdir(join(publicDir, '_next/static/chunks'), { recursive: true });
  await mkdir(join(publicDir, 'models/watti'), { recursive: true });
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>Fixture</title>');
  await writeFile(join(publicDir, '_next/static/chunks/game-Abcdef12.js'), 'export const ok=true;');
  await writeFile(join(publicDir, 'models/watti/model.glb'), Buffer.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]));
  await writeFile(join(dir, 'private.txt'), 'not public');
  return { dir, publicDir };
}

async function server(t: TestContext, options: Parameters<typeof createGameServer>[0] = {}) {
  const app = createGameServer({ port: 0, host: '127.0.0.1', autoTick: false, allowedOrigins: [], ...options });
  t.after(() => app.close());
  const port = await app.listen();
  return { app, port };
}

void test('health endpoint reports visitors that identify their presence', async t => {
  const { port } = await server(t);
  const before = JSON.parse((await request(port, '/healthz')).body.toString('utf8'));
  assert.equal(before.online, 0);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  t.after(() => socket.close());
  await once(socket, 'open');
  socket.send(JSON.stringify({type:'presence'}));
  await once(socket, 'message');
  const after = JSON.parse((await request(port, '/healthz')).body.toString('utf8'));
  assert.equal(after.online, 1);
});

function request(port: number, path: string, method = 'GET', headers: Record<string, string> = {}) {
  return new Promise<{status: number; headers: http.IncomingHttpHeaders; body: Buffer}>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers, agent: false }, res => {
      const parts: Buffer[] = [];
      res.on('data', part => parts.push(part));
      res.on('end', () => resolve({status: res.statusCode!, headers: res.headers, body: Buffer.concat(parts)}));
      res.on('error', reject);
    });
    req.setTimeout(2000, () => req.destroy(new Error('HTTP request timed out')));
    req.on('error', reject); req.end();
  });
}

function connect(port: number, origin?: string, headers: Record<string, string> = {}, path = '/ws') {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { origin, headers, handshakeTimeout: 2000 });
    ws.once('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

void test('HTTP GET/HEAD, ETag, immutable chunks, mutable models and GLB MIME', async t => {
  const fixture = await tempFixture(t), { port } = await server(t, { staticDirectory: fixture.publicDir });
  const get = await request(port, '/?room=ABC123');
  assert.equal(get.status, 200); assert.match(get.headers['content-type']!, /text\/html/);
  assert.equal(get.headers['cache-control'], 'no-cache'); assert.ok(get.body.length);
  const head = await request(port, '/', 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers['content-length']), get.body.length);
  assert.equal(head.headers.etag, get.headers.etag);
  const cached = await request(port, '/', 'GET', {'If-None-Match': get.headers.etag!});
  assert.equal(cached.status, 304); assert.equal(cached.body.length, 0);
  const js = await request(port, '/_next/static/chunks/game-Abcdef12.js');
  assert.equal(js.status, 200); assert.match(js.headers['content-type']!, /javascript/);
  assert.match(js.headers['cache-control']!, /immutable/);
  const glb = await request(port, '/models/watti/model.glb');
  assert.equal(glb.status, 200); assert.equal(glb.headers['content-type'], 'model/gltf-binary');
  assert.equal(glb.headers['cache-control'], 'no-cache'); assert.equal(glb.body.subarray(0, 4).toString(), 'glTF');
});

void test('HTTP raw paths reject traversal, dotfiles, malformed encodings and unsupported methods', async t => {
  const fixture = await tempFixture(t), { port } = await server(t, { staticDirectory: fixture.publicDir });
  for (const path of ['/../private.txt', '/%2e%2e/private.txt', '/%2e%2e%2fprivate.txt', '/.env', '/%2eopenai/hosting.json', '/%5c..%5cprivate.txt', '/%00', '/missing.js']) {
    assert.equal((await request(port, path)).status, 404, path);
  }
  assert.equal((await request(port, '/%E0%A4%A')).status, 400);
  const post = await request(port, '/', 'POST'); assert.equal(post.status, 405); assert.equal(post.headers.allow, 'GET, HEAD');
  const missingHead = await request(port, '/missing.js', 'HEAD'); assert.equal(missingHead.status, 404); assert.equal(missingHead.body.length, 0);
});

void test('HTTP cannot follow a public symlink outside export root', async t => {
  const fixture = await tempFixture(t);
  await mkdir(join(fixture.dir, 'outside'));
  await writeFile(join(fixture.dir, 'outside/secret.txt'), 'private');
  try { await symlink(join(fixture.dir, 'outside'), join(fixture.publicDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Host does not permit symlink creation'); return; } throw error; }
  const { port } = await server(t, { staticDirectory: fixture.publicDir });
  assert.equal((await request(port, '/linked/secret.txt')).status, 404);
});

void test('missing static index fails startup before listening', async t => {
  const fixture = await tempFixture(t);
  const app = createGameServer({port: 0, host: '127.0.0.1', autoTick: false, staticDirectory: join(fixture.dir, 'missing')});
  t.after(() => app.close()); await assert.rejects(app.listen()); assert.equal(app.server.listening, false);
});

void test('same-origin WS works through preserved proxy Host; malformed and foreign origins fail', async t => {
  const {port} = await server(t);
  const ws = await connect(port, 'https://football.example', {Host: 'football.example'});
  ws.send(JSON.stringify({type: 'ping', sent: 42}));
  const [raw] = await once(ws, 'message'); assert.equal(JSON.parse(raw.toString()).sent, 42);
  ws.close(); await once(ws, 'close');
  for (const origin of ['https://other.example', 'null', 'https://football.example/path', 'https://football.example.evil']) {
    await assert.rejects(connect(port, origin, {Host: 'football.example'}), /403/);
  }
  await assert.rejects(connect(port, 'http://127.0.0.1:' + port, {}, '/wrong'), /403/);
});

void test('explicit WS allowlist supports proxy upstream Host and rejects absent Origin', async t => {
  const {port} = await server(t, {allowedOrigins: ['https://football.example']});
  const ws = await connect(port, 'https://football.example'); ws.close(); await once(ws, 'close');
  await assert.rejects(connect(port), /403/);
  await assert.rejects(connect(port, `http://127.0.0.1:${port}`), /403/);
});

void test('per-IP WS cap cannot be bypassed with X-Forwarded-For and slots release', async t => {
  const saved = process.env.MAX_CONNECTIONS_PER_IP; process.env.MAX_CONNECTIONS_PER_IP = '2';
  t.after(() => { if (saved === undefined) delete process.env.MAX_CONNECTIONS_PER_IP; else process.env.MAX_CONNECTIONS_PER_IP = saved; });
  const {port} = await server(t), a = await connect(port), b = await connect(port);
  await assert.rejects(connect(port, undefined, {'X-Forwarded-For': '203.0.113.42'}), /403/);
  a.close(); await once(a, 'close');
  const c = await connect(port); b.close(); c.close(); await Promise.all([once(b, 'close'), once(c, 'close')]);
});

void test('global WS cap applies independently of the per-IP cap', async t => {
  const saved = process.env.MAX_CONNECTIONS; process.env.MAX_CONNECTIONS = '1';
  t.after(() => { if (saved === undefined) delete process.env.MAX_CONNECTIONS; else process.env.MAX_CONNECTIONS = saved; });
  const {port} = await server(t), a = await connect(port);
  await assert.rejects(connect(port), /403/); a.close(); await once(a, 'close');
});

void test('shutdown sends 1001, resolves once and stops accepting TCP connections', async t => {
  const {app, port} = await server(t), ws = await connect(port), closed = once(ws, 'close');
  const first = app.close(), second = app.close(); assert.equal(first, second);
  const [code] = await closed; assert.equal(code, 1001); await first;
  await assert.rejects(connect(port), /ECONNREFUSED/);
});

void test('shutdown forcibly closes an upgraded peer which does not answer close frames', async t => {
  const {app, port} = await server(t);
  const socket = net.connect(port, '127.0.0.1'); t.after(() => socket.destroy()); await once(socket, 'connect');
  socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
  const [data] = await once(socket, 'data'); assert.match(data.toString(), /101 Switching Protocols/);
  socket.resume(); const closed = once(socket, 'close'), start = performance.now();
  await app.close(); await closed; const elapsed = performance.now() - start;
  assert.ok(elapsed >= 2500 && elapsed < 5000, `shutdown took ${elapsed}ms`);
});

void test('static serving transfers the bundled Watti GLB without changing bytes', async t => {
  const fixture = await tempFixture(t);
  const path = 'models/watti/model.glb', source = await readFile(join(project, 'public', path));
  await writeFile(join(fixture.publicDir, path), source);
  const {port} = await server(t, {staticDirectory: fixture.publicDir});
  const model = await request(port, '/' + path);
  assert.equal(model.status, 200); assert.equal(model.headers['content-type'], 'model/gltf-binary'); assert.deepEqual(model.body, source);
});
