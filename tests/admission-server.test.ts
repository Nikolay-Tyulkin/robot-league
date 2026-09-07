import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.ts';
import { WIRE_PROTOCOL, SnapshotDecoder, encodeInput } from '../game/wire.ts';
import { idleInput } from '../game/sim.ts';
import type { AdmissionTicket } from '../server/admission.ts';
import type { ServerMessage } from '../game/network.ts';

type Stats = { online: number; inGame: number; admitted: number; capacity: number; waiting: number };
type AdmissionReply = AdmissionTicket & Stats;

async function fixture(t: TestContext, capacity = 2) {
  const app = createGameServer({ port: 0, capacity, maxWaiting: 4, autoTick: false, reconnectMs: 100, allowedOrigins: [] });
  t.after(() => app.close());
  const port = await app.listen(), base = `http://127.0.0.1:${port}`;
  const post = async (path: string, body: object, origin = base) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as AdmissionReply, headers: response.headers };
  };
  const join = async (name: string) => (await post('/admission', { action: 'join', visitorId: name.padEnd(24, '_') })).body;
  const connect = async (ticket?: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ticket ? [WIRE_PROTOCOL, `admission.${ticket}`] : []);
    const peer = new Peer(ws);
    await once(ws, 'open');
    return peer;
  };
  return { app, base, post, join, connect };
}

class Peer {
  messages: ServerMessage[] = [];
  decoder = new SnapshotDecoder();
  listeners = new Set<() => void>();
  constructor(public ws: WebSocket) {
    ws.on('message', (raw, binary) => {
      const bytes = Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
      const message = binary ? this.decoder.decode(bytes) : JSON.parse(Buffer.from(bytes).toString()) as ServerMessage;
      assert.ok(message, 'server packets must decode'); this.messages.push(message);
      this.listeners.forEach(f => f());
    });
  }
  send(value: object) { this.ws.send(JSON.stringify(value)); }
  wait<K extends ServerMessage['type']>(type: K, predicate: (message: Extract<ServerMessage, {type: K}>) => boolean = () => true): Promise<Extract<ServerMessage, {type: K}>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.listeners.delete(check); reject(new Error(`No ${type} message`)); }, 2000);
      const check = () => {
        const index = this.messages.findIndex(m => m.type === type && predicate(m as Extract<ServerMessage, {type: K}>));
        if (index >= 0) { clearTimeout(timeout); this.listeners.delete(check); resolve(this.messages.splice(index, 1)[0] as Extract<ServerMessage, {type: K}>); }
      };
      this.listeners.add(check); check();
    });
  }
}

void test('HTTP visitors and solo consume no multiplayer slots or WebSockets; waiting is FIFO', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 6; i++) assert.equal((await f.post('/presence', { visitorId: `visitor-${i}`.padEnd(24, '_') })).status, 200);
  const stats = await (await fetch(f.base + '/presence')).json() as Stats;
  assert.equal(stats.online, 6); assert.equal(stats.admitted, 0); assert.equal(f.app.wss.clients.size, 0);
  const a = await f.join('one'), b = await f.join('two'), c = await f.join('three'), d = await f.join('four');
  assert.equal(a.status, 'ready'); assert.equal(b.status, 'ready');
  assert.equal(c.status, 'waiting'); assert.equal(c.position, 1); assert.equal(d.position, 2);
  assert.equal(d.capacity, 2); assert.equal(d.admitted, 2); assert.equal(d.waiting, 2);
  assert.equal(f.app.wss.clients.size, 0, 'waiting clients do not open sockets');
  assert.equal((await f.join('three')).ticket, c.ticket, 'retrying join cannot gain a second place');
  await f.post('/admission', { action: 'cancel', ticket: a.ticket });
  const promoted = (await f.post('/admission', { action: 'poll', ticket: c.ticket })).body;
  assert.equal(promoted.status, 'ready');
  assert.equal((await f.post('/admission', { action: 'poll', ticket: d.ticket })).body.position, 1);
  assert.equal((await f.post('/presence', { visitorId: 'solo-still-available-000' })).status, 200);
});

void test('admission rejects foreign origins, malformed/oversized bodies, bad tickets and full waiting rooms', async t => {
  const f = await fixture(t, 1);
  assert.equal((await f.post('/admission', { action: 'join', visitorId: 'valid-visitor-0000' }, 'https://foreign.example')).status, 403);
  assert.equal((await f.post('/admission', { action: 'join', visitorId: 'x' })).status, 400);
  assert.equal((await f.post('/presence', { visitorId: 'x'.repeat(3000) })).status, 413);
  assert.equal((await f.post('/admission', { action: 'poll', ticket: '../secret' })).status, 400);
  assert.equal((await f.post('/admission', { action: 'poll', ticket: 'x'.repeat(32) })).status, 404);
  for (let i = 0; i < 5; i++) await f.join(`waiter${i}`);
  const full = await f.post('/admission', { action: 'join', visitorId: 'last-visitor-00000' });
  assert.equal(full.status, 503); assert.equal(full.headers.get('retry-after'), '10');
  assert.equal(f.app.admission.stats().waiting, 4);
});

void test('legacy sockets cannot bypass capacity; cancellation closes an active owner and frees its seat', async t => {
  const f = await fixture(t, 1), admission = await f.join('host'), host = await f.connect(admission.ticket);
  host.send({ type: 'create', kind: 'watti' }); await host.wait('room');
  const legacy = await f.connect(); legacy.send({ type: 'queue' });
  assert.match((await legacy.wait('error')).message, /full/);
  const next = await f.join('next'); assert.equal(next.status, 'waiting');
  const closed = once(host.ws, 'close');
  await f.post('/admission', { action: 'cancel', ticket: admission.ticket });
  await closed;
  assert.equal(f.app.rooms.size, 0);
  assert.equal((await f.post('/admission', { action: 'poll', ticket: next.ticket })).body.status, 'ready');
  assert.equal(f.app.admission.stats().admitted, 1);
});

void test('a claimed ticket cannot open a second socket, and room reconnect retains the reserved slot', async t => {
  const f = await fixture(t, 1), admission = await f.join('host'), host = await f.connect(admission.ticket);
  host.send({ type: 'create', kind: 'microduck' }); const room = await host.wait('room');
  await assert.rejects(f.connect(admission.ticket), /403/);
  const next = await f.join('next');
  const closed = once(host.ws, 'close'); host.ws.close(); await closed;
  const resumed = await f.connect(admission.ticket);
  resumed.send({ type: 'resume', code: room.room.code, token: room.token });
  assert.equal((await resumed.wait('room')).room.players[0].kind, 'microduck');
  assert.equal((await f.post('/admission', { action: 'poll', ticket: next.ticket })).body.status, 'waiting');
  const closedAgain = once(resumed.ws, 'close'); resumed.ws.close(); await closedAgain;
  await new Promise(resolve => setTimeout(resolve, 125));
  assert.equal((await f.post('/admission', { action: 'poll', ticket: next.ticket })).body.status, 'ready');
  await assert.rejects(f.connect(admission.ticket), /403/);
});

void test('binary and legacy peers receive identical authoritative state, skill edges, and a resync keyframe', async t => {
  const f = await fixture(t), admission = await f.join('binary'), a = await f.connect(admission.ticket), b = await f.connect();
  a.send({ type: 'create', name: 'Watti', kind: 'watti' }); const lobby = await a.wait('room');
  b.send({ type: 'join', name: 'Duck', kind: 'microduck', code: lobby.room.code }); await b.wait('room');
  a.send({ type: 'ready' }); b.send({ type: 'ready' });
  const first = await a.wait('state'), legacy = await b.wait('state');
  assert.deepEqual(first.state, legacy.state);
  assert.equal((await (await fetch(f.base + '/presence')).json() as Stats).inGame, 2);
  const room = f.app.rooms.get(lobby.room.code)!; room.state!.phase = 'play';
  a.ws.send(encodeInput({ ...idleInput(), seq: 1, x: .125, skill: true }));
  a.ws.send(encodeInput({ ...idleInput(), seq: 2, x: .25 }));
  a.send({ type: 'ping', sent: 7 }); await a.wait('pong');
  assert.equal(room.seats[0].input.skill, true);
  for (let i = 0; i < 3; i++) f.app.tick();
  const binary = await a.wait('state', m => m.state.tick === 3), json = await b.wait('state', m => m.state.tick === 3);
  assert.deepEqual(binary.state, json.state);
  assert.equal(binary.state.players[0].ack, 2);
  assert.ok(binary.state.players[0].skillCooldown > 0);
  a.decoder.reset(); a.send({ type: 'resync' });
  assert.deepEqual((await a.wait('state')).state, json.state);
});

void test('a reconnecting socket cannot reuse a reservation for another room or after its old lobby expires', async t => {
  const f = await fixture(t, 1), admission = await f.join('host'), host = await f.connect(admission.ticket);
  host.send({ type: 'create' }); await host.wait('room');
  const closed = once(host.ws, 'close'); host.ws.close(); await closed;
  const reconnecting = await f.connect(admission.ticket), waiter = await f.join('waiter');
  reconnecting.send({ type: 'create' }); assert.match((await reconnecting.wait('error')).message, /reserved room/);
  assert.equal(f.app.rooms.size, 1);
  const expired = once(reconnecting.ws, 'close');
  for (const room of f.app.rooms.values()) room.disconnectedAt = Date.now() - 150;
  f.app.tick(); await expired;
  assert.equal(f.app.rooms.size, 0);
  assert.equal((await f.post('/admission', { action: 'poll', ticket: waiter.ticket })).body.status, 'ready');
  const next = await f.connect(waiter.ticket); next.send({ type: 'create' }); await next.wait('room');
  assert.equal(f.app.rooms.size, 1); assert.equal(f.app.admission.stats().admitted, 1);
});

void test('opponent search receives live counts on its existing socket without counting a second visitor', async t => {
  const f = await fixture(t), admission = await f.join('searcher'), peer = await f.connect(admission.ticket);
  peer.send({ type: 'queue' }); await peer.wait('queued');
  const presence = await peer.wait('presence');
  assert.equal(presence.queued, 1); assert.equal(presence.online, 1);
  assert.equal(f.app.wss.clients.size, 1);
});
