import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { GameSocket, subscribeArenaPresence, type AdmissionInfo, type ServerMessage } from '../game/network.ts';
import { encodeInput, WIRE_PROTOCOL } from '../game/wire.ts';

class BrowserSocket {
  static OPEN = 1;
  static sockets: BrowserSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  protocol = WIRE_PROTOCOL;
  sent: (string | Uint8Array)[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string, readonly protocols: string[]) { BrowserSocket.sockets.push(this); }
  open() { this.readyState = BrowserSocket.OPEN; this.onopen?.(); }
  send(data: string | Uint8Array) { this.sent.push(data); }
  message(data: object | ArrayBuffer) { this.onmessage?.({ data: data instanceof ArrayBuffer ? data : JSON.stringify(data) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

const stats = { online: 205, queued: 0, inGame: 198, waiting: 5, admitted: 200, capacity: 200 };
const admission = (overrides: Partial<AdmissionInfo> = {}): AdmissionInfo => ({ type: 'admission', status: 'waiting', ticket: 'test-ticket', position: 5, expiresAt: 45000, retryAfterMs: 2500, ...stats, ...overrides });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function browser(t: TestContext, respond: (body: Record<string, unknown>, init: RequestInit) => Response | Promise<Response>) {
  const cleanup: (() => void)[] = [];
  t.after(() => cleanup.forEach(run => run()));
  const storage = new Map<string, string>([['robot-league.visitor', 'copied-from-another-tab']]), events = new EventTarget();
  const values = { location: { protocol: 'http:', host: 'localhost:3000' }, window: events, sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, WebSocket: BrowserSocket };
  for (const [key, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
  }
  BrowserSocket.sockets = [];
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  t.mock.method(Math, 'random', () => 0.5);
  const requests: { url: string; body: Record<string, unknown>; init: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>;
    requests.push({ url, body, init });
    return body.action === 'cancel' ? json({ ok: true }) : respond(body, init);
  });
  return { requests, events, cleanup };
}

void test('presence uses one stable HTTP identity, no sockets, and stops its heartbeat on unsubscribe', async t => {
  const { requests } = browser(t, () => json({ type: 'presence', ...stats }));
  const updates: unknown[] = [];
  const stop = subscribeArenaPresence((online, queued, presence) => updates.push({ online, queued, presence }));
  await settle();
  assert.equal(updates.length, 1);
  assert.equal(BrowserSocket.sockets.length, 0);
  assert.equal(requests[0].url, 'http://localhost:3000/presence');
  assert.equal(typeof requests[0].body.visitorId, 'string');
  assert.notEqual(requests[0].body.visitorId, 'copied-from-another-tab');
  t.mock.timers.tick(15000); await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.visitorId, requests[0].body.visitorId);
  stop(); t.mock.timers.tick(60000); await settle();
  assert.equal(requests.length, 2);
  assert.equal(updates.length, 2);
});

void test('unsubscribe aborts in-flight presence and ignores a late response', async t => {
  let resolveResponse!: (response: Response) => void;
  const { requests } = browser(t, () => new Promise(resolve => { resolveResponse = resolve; }));
  let changes = 0;
  const stop = subscribeArenaPresence(() => changes++);
  stop();
  assert.equal(requests[0].init.signal?.aborted, true);
  resolveResponse(json({ type: 'presence', ...stats })); await settle();
  t.mock.timers.tick(60000); await settle();
  assert.equal(changes, 0);
  assert.equal(requests.length, 1);
});

void test('waiting admission polls before opening a binary socket and preserves the original room intent', async t => {
  const { requests, cleanup } = browser(t, body => json(admission(body.action === 'poll' ? { status: 'ready', position: 0 } : {})));
  const messages: ServerMessage[] = [], connections: boolean[] = [];
  const client = new GameSocket(message => messages.push(message), () => {}, connected => connections.push(connected));
  cleanup.push(() => client.close());
  const initial = { type: 'join', code: 'ABC123', kind: 'reachy', name: 'Player' };
  client.connect(initial); await settle();
  assert.equal(BrowserSocket.sockets.length, 0);
  assert.equal(client.connected, false);
  assert.equal(messages[0].type, 'admission');
  t.mock.timers.tick(2500); await settle();
  assert.deepEqual(requests[1].body, { action: 'poll', ticket: 'test-ticket' });
  const ws = BrowserSocket.sockets[0];
  assert.deepEqual(ws.protocols, [WIRE_PROTOCOL, 'admission.test-ticket']);
  assert.equal(ws.binaryType, 'arraybuffer');
  assert.equal(ws.sent.length, 0);
  ws.open();
  assert.deepEqual(JSON.parse(ws.sent[0] as string), initial);
  assert.equal(client.connected, true);
  assert.equal(connections.at(-1), true);
  const input = { seq: 19, x: 0.5, z: -1, sprint: true, charge: false, shoot: true, tap: false, skill: true };
  client.input(input);
  assert.ok(ws.sent[1] instanceof Uint8Array);
  assert.deepEqual(ws.sent[1], encodeInput(input));
  ws.message(new ArrayBuffer(2)); ws.message(new ArrayBuffer(2));
  assert.equal(ws.sent.filter(value => typeof value === 'string' && JSON.parse(value).type === 'resync').length, 1);
});

void test('cancel during a pending poll releases the place and cannot open a late ready socket', async t => {
  let resolvePoll!: (response: Response) => void;
  const { requests } = browser(t, body => body.action === 'poll' ? new Promise(resolve => { resolvePoll = resolve; }) : json(admission()));
  const messages: ServerMessage[] = [];
  const client = new GameSocket(message => messages.push(message), () => {});
  client.connect({ type: 'queue' }); await settle();
  t.mock.timers.tick(2500); await settle();
  client.close();
  assert.equal(requests[1].init.signal?.aborted, true);
  assert.ok(requests.some(request => request.body.action === 'cancel' && request.body.ticket === 'test-ticket'));
  resolvePoll(json(admission({ status: 'ready', position: 0 }))); await settle();
  t.mock.timers.tick(60000); await settle();
  assert.equal(BrowserSocket.sockets.length, 0);
  assert.equal(messages.length, 1);
});

void test('a cancelled first admission ignores its late response and releases its reserved ticket', async t => {
  let resolveJoin!: (response: Response) => void;
  const { requests } = browser(t, () => new Promise(resolve => { resolveJoin = resolve; }));
  const client = new GameSocket(() => assert.fail('Late message after cancellation'), () => {});
  client.connect({ type: 'create' }); client.close();
  resolveJoin(json(admission({ status: 'ready', position: 0 }))); await settle();
  assert.equal(BrowserSocket.sockets.length, 0);
  assert.equal(requests.at(-1)?.body.action, 'cancel');
});

void test('room reconnect reuses admission ticket and room token without rejoining the waiting list', async t => {
  const { requests, cleanup } = browser(t, () => json(admission({ status: 'ready', position: 0 })));
  const client = new GameSocket(() => {}, () => {});
  cleanup.push(() => client.close());
  client.connect({ type: 'create' }); await settle();
  const first = BrowserSocket.sockets[0]; first.open();
  first.message({ type: 'room', room: { code: 'ROOM42', player: 0, players: [], private: true }, token: 'room-secret' });
  first.close();
  assert.equal(client.connected, false);
  t.mock.timers.tick(1200);
  const second = BrowserSocket.sockets[1]; second.open();
  assert.deepEqual(second.protocols, first.protocols);
  assert.deepEqual(JSON.parse(second.sent[0] as string), { type: 'resume', code: 'ROOM42', token: 'room-secret' });
  assert.equal(requests.length, 1);
});

void test('queue disconnect reacquires admission and replays matchmaking without an expired ticket', async t => {
  let joined = 0;
  const { requests, cleanup } = browser(t, () => json(admission({ status: 'ready', ticket: `ticket-${++joined}`, position: 0 })));
  const client = new GameSocket(() => {}, () => {});
  cleanup.push(() => client.close());
  client.connect({ type: 'queue', kind: 'watti' }); await settle();
  const first = BrowserSocket.sockets[0]; first.open(); first.message({ type: 'queued' }); first.close();
  t.mock.timers.tick(1000); await settle();
  const second = BrowserSocket.sockets[1]; second.open();
  assert.deepEqual(second.protocols, [WIRE_PROTOCOL, 'admission.ticket-2']);
  assert.deepEqual(JSON.parse(second.sent[0] as string), { type: 'queue', kind: 'watti' });
  assert.equal(requests.filter(request => request.body.action === 'join').length, 2);
});

void test('matchmaking receives changing presence counts over its existing game socket', async t => {
  const { requests, cleanup } = browser(t, () => json(admission({ status: 'ready', position: 0 })));
  const messages: ServerMessage[] = [];
  const client = new GameSocket(message => messages.push(message), () => {});
  cleanup.push(() => client.close());
  client.connect({ type: 'queue' }); await settle();
  const ws = BrowserSocket.sockets[0]; ws.open(); ws.message({ type: 'queued' });
  ws.message({ type: 'presence', ...stats, queued: 1 });
  ws.message({ type: 'presence', ...stats, queued: 2 });
  const counts = messages.filter(message => message.type === 'presence').map(message => message.queued);
  assert.deepEqual(counts, [1, 2]);
  assert.equal(client.connected, true);
  assert.equal(BrowserSocket.sockets.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(ws.sent.some(value => typeof value === 'string' && JSON.parse(value).type === 'presence'), false);
});
