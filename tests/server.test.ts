import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.ts';
import { idleInput, finish, ROBOT_KINDS } from '../game/sim.ts';
import type { ServerMessage } from '../game/network.ts';

class Peer {
  inbox: ServerMessage[] = [];
  listeners = new Set<() => void>();
  constructor(public ws: WebSocket) {
    ws.on('message', raw => {
      const b = Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof ArrayBuffer ? Buffer.from(raw) : raw;
      this.inbox.push(JSON.parse(b.toString('utf8')) as ServerMessage); this.listeners.forEach(f => f());
    });
  }
  send(message: object) { this.ws.send(JSON.stringify(message)); }
  wait<K extends ServerMessage['type']>(type: K, predicate: (m: Extract<ServerMessage, {type: K}>) => boolean = () => true) {
    return new Promise<Extract<ServerMessage, {type: K}>>((resolve, reject) => {
      const timeout = setTimeout(() => { this.listeners.delete(check); reject(new Error(`Timed out waiting for ${type}`)); }, 1800);
      const check = () => {
        const index = this.inbox.findIndex(m => m.type === type && predicate(m as Extract<ServerMessage, {type: K}>));
        if (index >= 0) { clearTimeout(timeout); this.listeners.delete(check); resolve(this.inbox.splice(index, 1)[0] as Extract<ServerMessage, {type: K}>); }
      };
      this.listeners.add(check); check();
    });
  }
  async barrier() { const sent = Math.random(); this.send({type:'ping', sent}); await this.wait('pong', m => m.sent === sent); }
}
async function fixture(reconnectMs = 300) {
  const app = createGameServer({port:0, autoTick:false, reconnectMs}); const port = await app.listen();
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), peer = new Peer(ws);
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }); return peer;
  };
  return {app, connect};
}
async function privateMatch(f: Awaited<ReturnType<typeof fixture>>) {
  const a = await f.connect(), b = await f.connect();
  a.send({type:'create',name:'Watti',kind:'watti'}); const created = await a.wait('room');
  b.send({type:'join',name:'Duck',code:created.room.code}); const joined = await b.wait('room');
  a.send({type:'ready'}); b.send({type:'ready'}); await a.wait('state'); await b.wait('state');
  const room = f.app.rooms.get(created.room.code)!; assert.ok(room.state);
  return {a,b,room,token:joined.token,code:created.room.code};
}

void test('private match admits two players and server owns inputs, kick edges and score', async t => {
  const f = await fixture(); t.after(() => f.app.close()); const {a,b,room,code} = await privateMatch(f);
  const third = await f.connect(); third.send({type:'join',code,name:'Third'}); assert.match((await third.wait('error')).message,/full/);
  room.state!.phase = 'play';
  a.send({type:'input',input:{...idleInput(),seq:1,x:9,shoot:true}}); await a.barrier(); assert.equal(room.seats[0].input.seq,0);
  a.send({type:'input',input:{...idleInput(),seq:2,x:1,shoot:true}});
  a.send({type:'input',input:{...idleInput(),seq:3,x:1}}); await a.barrier();
  assert.equal(room.seats[0].input.shoot,true); f.app.tick(); assert.equal(room.state!.players[0].action,'kick'); assert.equal(room.seats[0].input.shoot,false);
  const before = room.state!.players[0].x;
  b.send({type:'input',player:0,input:{...idleInput(),seq:1,x:-1},score:[99,0]}); await b.barrier(); f.app.tick();
  assert.ok(room.state!.players[0].x > before); assert.deepEqual(room.state!.score,[0,0]);
  room.seats[0].lastInput = Date.now() - 400; f.app.tick(); assert.equal(room.seats[0].input.x,0);
});

void test('presence reports queue entry, matching, cancellation and disconnection', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  const observer = await f.connect(); observer.send({type:'presence'});
  assert.equal((await observer.wait('presence')).queued, 0);
  const a = await f.connect(), b = await f.connect();
  a.send({type:'queue',name:'A'}); await a.wait('queued');
  assert.equal((await observer.wait('presence')).queued, 1);
  b.send({type:'queue',name:'B'}); await b.wait('room');
  assert.equal((await observer.wait('presence')).queued, 0);
  const waiting = await f.connect(); waiting.send({type:'queue',name:'C'}); await waiting.wait('queued');
  assert.equal((await observer.wait('presence')).queued, 1);
  waiting.send({type:'leave'});
  assert.equal((await observer.wait('presence')).queued, 0);
  waiting.send({type:'queue',name:'C'}); await waiting.wait('queued');
  assert.equal((await observer.wait('presence')).queued, 1);
  waiting.ws.close();
  assert.equal((await observer.wait('presence')).queued, 0);
});

void test('queue pairs once and removes a disconnected waiting peer', async t => {
  const f = await fixture(); t.after(() => f.app.close()); const a = await f.connect(), b = await f.connect();
  a.send({type:'queue',name:'A'}); await a.wait('queued'); b.send({type:'queue',name:'B'});
  const ra = await a.wait('room'), rb = await b.wait('room'); assert.equal(ra.room.code,rb.room.code); assert.equal(rb.room.players.length,2); assert.equal(f.app.queue.length,0);
  const waiting = await f.connect(); waiting.send({type:'queue',name:'C'}); await waiting.wait('queued');
  waiting.ws.close(); await new Promise<void>(r => waiting.ws.once('close', r)); await a.barrier(); assert.equal(f.app.queue.length,0);
});

void test('disconnect freezes match, token restores it, expired disconnect forfeits', async t => {
  const f = await fixture(); t.after(() => f.app.close()); const {a,b,room,token,code} = await privateMatch(f);
  room.state!.phase='play'; b.ws.terminate(); await a.wait('state',m=>m.state.phase==='paused');
  const clock=room.state!.time; for(let i=0;i<10;i++) f.app.tick(); assert.equal(room.state!.time,clock);
  const bad=await f.connect(); bad.send({type:'resume',code,token:'invalid'}); await bad.wait('error'); assert.equal(room.seats[1].ws,null);
  const reconnected=await f.connect(); reconnected.send({type:'resume',code,token}); await reconnected.wait('room'); await reconnected.wait('state',m=>m.state.phase==='play');
  assert.equal(room.state!.phase,'play'); await a.barrier(); a.inbox=[]; reconnected.ws.terminate(); await a.wait('state',m=>m.state.phase==='paused');
  room.disconnectedAt=Date.now()-301; f.app.tick(); assert.equal(room.state!.phase,'finished'); assert.equal(room.state!.winner,0);
});

void test('two rematch votes reset match; expired lobby detaches both clients', async t => {
  const f=await fixture();t.after(()=>f.app.close());const {a,b,room}=await privateMatch(f);
  finish(room.state!,0);room.state!.score=[5,1];a.send({type:'rematch'});await a.barrier();assert.equal(room.state!.phase,'finished');
  b.send({type:'rematch'});await b.barrier();assert.equal(room.state!.phase,'countdown');assert.equal(room.state!.tick,0);assert.deepEqual(room.state!.score,[0,0]);
  const c=await f.connect();c.send({type:'create',name:'C'});const old=await c.wait('room');f.app.rooms.get(old.room.code)!.updatedAt=Date.now()-600001;f.app.tick();await c.wait('error');
  c.send({type:'create',name:'C'});const fresh=await c.wait('room');assert.notEqual(fresh.room.code,old.room.code);assert.equal(f.app.rooms.has(old.room.code),false);
});

void test('private rooms preserve all nine chosen pairings from lobby through rematch', async t => {
  for (const kind of ROBOT_KINDS) for (const opponent of ROBOT_KINDS) {
    await t.test(`${kind} versus ${opponent}`, async subtest => {
      const f = await fixture(); subtest.after(() => f.app.close());
      const a = await f.connect(), b = await f.connect();
      a.send({type:'create', name:'Host', kind}); const created = await a.wait('room');
      b.send({type:'join', name:'Guest', code:created.room.code, kind:opponent}); const joined = await b.wait('room');
      assert.deepEqual(joined.room.players.map(p => p.kind), [kind, opponent]);
      a.send({type:'ready'}); b.send({type:'ready'});
      const [first, second] = await Promise.all([a.wait('state'), b.wait('state')]);
      assert.deepEqual(first.state.players.map(p => p.kind), [kind, opponent]);
      assert.deepEqual(second.state.players.map(p => p.kind), [kind, opponent]);
      const room = f.app.rooms.get(created.room.code)!; finish(room.state!, 0); room.state!.score = [5, 2];
      a.send({type:'rematch'}); await a.barrier(); assert.equal(room.state!.phase, 'finished');
      b.send({type:'rematch'});
      const rematch = await b.wait('state');
      assert.equal(rematch.state.phase, 'countdown'); assert.deepEqual(rematch.state.score, [0, 0]);
      assert.deepEqual(rematch.state.players.map(p => p.kind), [kind, opponent]);
      assert.deepEqual(rematch.state.players.map(p => p.name), ['Host', 'Guest']);
    });
  }
});

void test('queue remembers the waiting player kind and permits selected mirror matches', async t => {
  for (const [kind, opponent] of [['reachy','microduck'], ['microduck','reachy'], ['reachy','reachy'], ['watti','watti']] as const) {
    await t.test(`${kind} versus ${opponent}`, async subtest => {
      const f = await fixture(); subtest.after(() => f.app.close());
      const a = await f.connect(), b = await f.connect();
      a.send({type:'queue', name:'Waiting', kind}); await a.wait('queued');
      b.send({type:'queue', name:'Arriving', kind:opponent}); const joined = await b.wait('room');
      assert.equal(joined.room.private, false); assert.equal(f.app.queue.length, 0);
      assert.deepEqual(joined.room.players.map(p => p.kind), [kind, opponent]);
      a.send({type:'ready'}); b.send({type:'ready'}); const first = await a.wait('state'); await b.wait('state');
      assert.deepEqual(first.state.players.map(p => p.kind), [kind, opponent]);
      const room = f.app.rooms.get(joined.room.code)!; finish(room.state!, 1);
      a.send({type:'rematch'}); b.send({type:'rematch'});
      const rematch = await b.wait('state'); assert.deepEqual(rematch.state.players.map(p => p.kind), [kind, opponent]);
    });
  }
});

void test('legacy joins keep deterministic opponent defaults and invalid kinds never enter state', async t => {
  for (const hostKind of ['watti', 'microduck', 'reachy', 'unknown'] as const) {
    await t.test(`legacy join to ${hostKind}`, async subtest => {
      const f = await fixture(); subtest.after(() => f.app.close());
      const a = await f.connect(), b = await f.connect();
      a.send({type:'create', name:'Host', kind:hostKind}); const created = await a.wait('room');
      b.send({type:'join', name:'Legacy', code:created.room.code}); const joined = await b.wait('room');
      const kind = hostKind === 'unknown' ? 'watti' : hostKind;
      assert.deepEqual(joined.room.players.map(p => p.kind), [kind, kind === 'watti' ? 'microduck' : 'watti']);
    });
  }
  const f = await fixture(); t.after(() => f.app.close());
  const a = await f.connect(), b = await f.connect();
  a.send({type:'create', name:'Host', kind:'reachy'}); const created = await a.wait('room');
  b.send({type:'join', name:'Invalid', code:created.room.code, kind:{name:'reachy'}}); const joined = await b.wait('room');
  assert.deepEqual(joined.room.players.map(p => p.kind), ['reachy', 'watti']);
});

async function lobby(f: Awaited<ReturnType<typeof fixture>>, queued = false) {
  const a = await f.connect(), b = await f.connect();
  if (queued) {
    a.send({type:'queue', name:'Host', kind:'watti'}); await a.wait('queued');
    b.send({type:'queue', name:'Guest', kind:'microduck'});
  } else {
    a.send({type:'create', name:'Host', kind:'watti'}); const created = await a.wait('room');
    b.send({type:'join', name:'Guest', code:created.room.code, kind:'microduck'});
  }
  const [host, guest] = await Promise.all([a.wait('room', m => m.room.players.length === 2), b.wait('room')]);
  assert.equal(host.room.code, guest.room.code);
  return {a, b, room:f.app.rooms.get(host.room.code)!};
}

async function assertLobbyChoices(a: Peer, b: Peer, kinds: readonly string[], ready = [false, false]) {
  const matches = (m: Extract<ServerMessage, {type:'room'}>) =>
    m.room.players.length === kinds.length && m.room.players.every((p, i) => p.kind === kinds[i] && p.ready === ready[i]);
  const [host, guest] = await Promise.all([a.wait('room', matches), b.wait('room', matches)]);
  assert.deepEqual(host.room.players, guest.room.players);
  assert.deepEqual(host.room.players.map(p => p.kind), kinds);
  assert.deepEqual(host.room.players.map(p => p.ready), ready);
  assert.equal(host.room.player, 0); assert.equal(guest.room.player, 1);
}

void test('lobby robot changes broadcast both choices and invalidate readiness in private and queued rooms', async t => {
  for (const queued of [false, true]) {
    await t.test(queued ? 'quick match' : 'private room', async subtest => {
      const f = await fixture(); subtest.after(() => f.app.close()); const {a,b,room} = await lobby(f, queued);
      a.send({type:'ready'}); await assertLobbyChoices(a,b,['watti','microduck'],[true,false]);
      a.send({type:'select-robot',kind:'reachy'}); await assertLobbyChoices(a,b,['reachy','microduck']);
      assert.deepEqual(room.seats.map(s => s.ready), [false,false]);
      a.send({type:'ready'}); await assertLobbyChoices(a,b,['reachy','microduck'],[true,false]);
      b.send({type:'select-robot',kind:'reachy'}); await assertLobbyChoices(a,b,['reachy','reachy']);
      assert.deepEqual(room.seats.map(s => s.ready), [false,false]);
      b.send({type:'ready'}); await assertLobbyChoices(a,b,['reachy','reachy'],[false,true]);
      assert.equal(room.state, undefined, 'old readiness must not start the changed pairing');
      a.send({type:'ready'}); const [first,second] = await Promise.all([a.wait('state'),b.wait('state')]);
      assert.deepEqual(first.state.players.map(p => p.kind), ['reachy','reachy']);
      assert.deepEqual(second.state.players.map(p => p.kind), ['reachy','reachy']);
    });
  }
});

void test('every robot pairing can be chosen inside an existing room and survives rematch', async t => {
  for (const kind of ROBOT_KINDS) for (const opponent of ROBOT_KINDS) {
    await t.test(`${kind} versus ${opponent}`, async subtest => {
      const f = await fixture(); subtest.after(() => f.app.close()); const {a,b,room} = await lobby(f);
      a.send({type:'select-robot',kind}); await a.barrier();
      b.send({type:'select-robot',kind:opponent}); await assertLobbyChoices(a,b,[kind,opponent]);
      a.send({type:'ready'}); b.send({type:'ready'});
      const [first,second] = await Promise.all([a.wait('state'),b.wait('state')]);
      assert.deepEqual(first.state.players.map(p => p.kind), [kind,opponent]);
      assert.deepEqual(second.state.players.map(p => p.kind), [kind,opponent]);
      finish(room.state!,0); a.send({type:'rematch'}); b.send({type:'rematch'});
      const rematch = await b.wait('state');
      assert.equal(rematch.state.phase,'countdown');
      assert.deepEqual(rematch.state.players.map(p => p.kind), [kind,opponent]);
    });
  }
});

void test('a host can choose before anyone joins and selecting the same kind preserves readiness', async t => {
  const f = await fixture(); t.after(() => f.app.close()); const a = await f.connect(), b = await f.connect();
  a.send({type:'create',name:'Host',kind:'watti'}); const created = await a.wait('room');
  a.send({type:'ready'}); await a.wait('room',m => m.room.players[0].ready);
  a.send({type:'select-robot',kind:'reachy'});
  const changed = await a.wait('room',m => m.room.players[0].kind === 'reachy');
  assert.equal(changed.room.players.length,1); assert.equal(changed.room.players[0].ready,false);
  b.send({type:'join',name:'Guest',code:created.room.code,kind:'microduck'});
  await assertLobbyChoices(a,b,['reachy','microduck']);
  a.send({type:'ready'}); await assertLobbyChoices(a,b,['reachy','microduck'],[true,false]);
  a.inbox=[]; b.inbox=[];
  b.send({type:'select-robot',kind:'microduck'});
  await assertLobbyChoices(a,b,['reachy','microduck'],[true,false]);
  b.send({type:'ready'}); await a.wait('state'); await b.wait('state');
});

void test('invalid lobby selections preserve both kinds and existing readiness', async t => {
  const f = await fixture(); t.after(() => f.app.close()); const {a,b,room} = await lobby(f);
  a.send({type:'ready'}); await assertLobbyChoices(a,b,['watti','microduck'],[true,false]);
  a.inbox=[]; b.inbox=[];
  for (const kind of [undefined,null,0,false,{},[], '', 'Watti','unknown','__proto__','constructor']) {
    a.send({type:'select-robot',kind}); assert.match((await a.wait('error')).message,/available robot/);
    assert.deepEqual(room.seats.map(s => s.kind), ['watti','microduck']);
    assert.deepEqual(room.seats.map(s => s.ready), [true,false]);
    assert.equal(room.state,undefined);
  }
  await b.barrier();
  assert.equal(a.inbox.some(m => m.type === 'room'),false);
  assert.equal(b.inbox.some(m => m.type === 'room'),false);
});

void test('robot selection only changes the sender seat and rejects clients outside a room', async t => {
  const f = await fixture(); t.after(() => f.app.close()); const {a,b,room} = await lobby(f);
  a.send({type:'select-robot',kind:'reachy',player:1,seat:1,code:'FOREIGN',ready:true,players:[{kind:'reachy'},{kind:'reachy'}]});
  await assertLobbyChoices(a,b,['reachy','microduck']);
  assert.deepEqual(room.seats.map(s => s.name), ['Host','Guest']);
  b.send({type:'select-robot',kind:'watti',player:0,seat:0}); await assertLobbyChoices(a,b,['reachy','watti']);
  const outsider = await f.connect();
  outsider.send({type:'select-robot',code:room.code,seat:0,kind:'microduck'});
  assert.match((await outsider.wait('error')).message,/Join a room/);
  assert.deepEqual(room.seats.map(s => s.kind), ['reachy','watti']);
  outsider.send({type:'queue',kind:'watti'}); await outsider.wait('queued');
  outsider.send({type:'select-robot',kind:'reachy'}); assert.match((await outsider.wait('error')).message,/Join a room/);
  const arrival = await f.connect(); arrival.send({type:'queue',kind:'microduck'});
  const paired = await arrival.wait('room'); assert.deepEqual(paired.room.players.map(p => p.kind), ['watti','microduck']);
});

void test('robot selections stay locked throughout an existing match including pause and results', async t => {
  const f = await fixture(); t.after(() => f.app.close()); const {a,b,room} = await privateMatch(f);
  for (const phase of ['countdown','play','goal','paused','finished'] as const) {
    room.state!.phase=phase;
    const before=structuredClone(room.state);
    a.send({type:'select-robot',kind:'reachy'}); assert.match((await a.wait('error')).message,/locked/);
    b.send({type:'select-robot',kind:'microduck'}); assert.match((await b.wait('error')).message,/locked/);
    assert.deepEqual(room.seats.map(s => s.kind), ['watti','microduck']);
    assert.deepEqual(room.state,before);
  }
});

void test('either lobby player can resume their reserved seat and choices after a connection loss', async t => {
  for (const queued of [false,true]) for (const dropped of [0,1]) {
    await t.test(`${queued ? 'queued' : 'private'} room, player ${dropped}`, async subtest => {
      const f=await fixture(3000); subtest.after(()=>f.app.close()); const {a,b,room}=await lobby(f,queued);
      a.send({type:'select-robot',kind:'reachy'}); await assertLobbyChoices(a,b,['reachy','microduck']);
      const peers=[a,b], survivor=peers[1-dropped], token=room.seats[dropped].token;
      survivor.send({type:'ready'}); await assertLobbyChoices(a,b,['reachy','microduck'],[dropped===1,dropped===0]);
      const closed=new Promise<void>(resolve=>room.seats[dropped].ws!.once('close',()=>resolve()));
      peers[dropped].ws.terminate(); await closed;
      const disconnected=await survivor.wait('room',m=>m.room.players[dropped]?.connected===false);
      assert.equal(f.app.rooms.get(room.code),room);
      assert.deepEqual(disconnected.room.players.map(p=>p.ready),[false,false]);
      assert.deepEqual(disconnected.room.players.map(p=>p.kind),['reachy','microduck']);
      assert.equal(room.state,undefined); assert.ok(room.disconnectedAt);
      survivor.send({type:'ready'}); await survivor.wait('room',m=>m.room.players[1-dropped].ready);
      f.app.tick(); assert.equal(room.state,undefined,'a ready survivor cannot start without the disconnected seat');
      const bad=await f.connect(); bad.send({type:'resume',code:room.code,token:'invalid'});
      await bad.wait('error'); assert.equal(room.seats[dropped].ws,null);
      bad.send({type:'join',code:room.code,kind:'watti'}); assert.match((await bad.wait('error')).message,/full/);
      const returning=await f.connect(); returning.send({type:'resume',code:room.code,token,name:'Replacement',kind:'watti',seat:1-dropped});
      const restored=await returning.wait('room');
      await survivor.wait('room',m=>m.room.players.length===2 && m.room.players.every(p=>p.connected));
      assert.equal(restored.token,token); assert.equal(restored.room.player,dropped);
      assert.deepEqual(restored.room.players.map(p=>p.name),['Host','Guest']);
      assert.deepEqual(restored.room.players.map(p=>p.kind),['reachy','microduck']);
      assert.ok(restored.room.players.every(p=>p.connected));
      assert.equal(restored.room.players[dropped].ready,false); assert.equal(room.disconnectedAt,undefined);
      returning.send({type:'ready'});
      const started=await returning.wait('state'); await survivor.wait('state');
      assert.deepEqual(started.state.players.map(p=>p.kind),['reachy','microduck']);
    });
  }
});

void test('a vacant guest seat stays joinable while the host reconnects without extending the grace period', async t => {
  const f=await fixture(3000); t.after(()=>f.app.close()); const host=await f.connect();
  host.send({type:'create',name:'Host',kind:'reachy'}); const created=await host.wait('room');
  const room=f.app.rooms.get(created.room.code)!;
  const closed=new Promise<void>(resolve=>room.seats[0].ws!.once('close',()=>resolve()));
  host.ws.terminate(); await closed; const disconnectedAt=room.disconnectedAt;
  f.app.tick(); assert.equal(f.app.rooms.get(room.code),room);
  const guest=await f.connect(); guest.send({type:'join',code:room.code,name:'Guest',kind:'reachy'});
  const joined=await guest.wait('room'); assert.equal(joined.room.player,1);
  assert.deepEqual(joined.room.players.map(p=>p.connected),[false,true]);
  assert.deepEqual(joined.room.players.map(p=>p.kind),['reachy','reachy']);
  assert.equal(room.disconnectedAt,disconnectedAt);
  guest.send({type:'ready'}); await guest.wait('room',m=>m.room.players[1].ready); assert.equal(room.state,undefined);
  const returning=await f.connect(); returning.send({type:'resume',code:room.code,token:created.token});
  const restored=await returning.wait('room'); await guest.wait('room',m=>m.room.players[0].connected);
  assert.equal(restored.room.player,0); assert.equal(restored.room.players[0].name,'Host');
  assert.equal(room.disconnectedAt,undefined); assert.equal(room.state,undefined);
});

void test('explicit lobby leave closes the room immediately and releases both connected clients', async t => {
  const f=await fixture(); t.after(()=>f.app.close()); const {a,b,room}=await lobby(f);
  const token=room.seats[0].token;
  a.send({type:'leave'}); assert.match((await b.wait('error')).message,/opponent left/);
  assert.equal(f.app.rooms.has(room.code),false);
  a.send({type:'create',name:'A'}); const nextA=await a.wait('room');
  b.send({type:'create',name:'B'}); const nextB=await b.wait('room');
  assert.notEqual(nextA.room.code,room.code); assert.notEqual(nextB.room.code,room.code);
  const returning=await f.connect(); returning.send({type:'resume',code:room.code,token});
  assert.match((await returning.wait('error')).message,/ended/);
});

void test('lobby reconnection expiry rejects a late token and detaches an active survivor despite room updates', async t => {
  const f=await fixture(); t.after(()=>f.app.close()); const {a,b,room}=await lobby(f);
  const token=room.seats[1].token;
  b.ws.terminate(); await a.wait('room',m=>!m.room.players[1].connected);
  const expiredAt=Date.now()-301; room.disconnectedAt=expiredAt;
  a.send({type:'select-robot',kind:'reachy'}); await a.wait('room',m=>m.room.players[0].kind==='reachy');
  assert.equal(room.disconnectedAt,expiredAt,'ordinary lobby activity does not extend the disconnect deadline');
  assert.ok(room.updatedAt>expiredAt);
  const returning=await f.connect(); returning.send({type:'resume',code:room.code,token});
  assert.match((await returning.wait('error')).message,/reconnection window has expired/);
  assert.equal(room.seats[1].ws,null);
  f.app.tick(); assert.equal(f.app.rooms.has(room.code),false);
  assert.match((await a.wait('error')).message,/room has expired/);
  a.send({type:'create',name:'A'}); const fresh=await a.wait('room'); assert.notEqual(fresh.room.code,room.code);
});

void test('fully disconnected lobbies expire and neither late joins nor resumes resurrect them', async t => {
  const f=await fixture(); t.after(()=>f.app.close()); const host=await f.connect();
  host.send({type:'create',kind:'reachy'}); const created=await host.wait('room'); const room=f.app.rooms.get(created.room.code)!;
  const hostClosed=new Promise<void>(resolve=>room.seats[0].ws!.once('close',()=>resolve()));
  host.ws.terminate(); await hostClosed; room.disconnectedAt=Date.now()-301;
  const guest=await f.connect(); guest.send({type:'join',code:room.code});
  assert.match((await guest.wait('error')).message,/expired/); assert.equal(room.seats.length,1);
  f.app.tick(); assert.equal(f.app.rooms.has(room.code),false);
  guest.send({type:'resume',code:room.code,token:created.token}); assert.match((await guest.wait('error')).message,/ended/);

  const pair=await lobby(f), firstClosed=new Promise<void>(resolve=>pair.room.seats[0].ws!.once('close',()=>resolve()));
  pair.a.ws.terminate(); await firstClosed; const deadline=pair.room.disconnectedAt;
  const secondClosed=new Promise<void>(resolve=>pair.room.seats[1].ws!.once('close',()=>resolve()));
  pair.b.ws.terminate(); await secondClosed;
  assert.equal(pair.room.disconnectedAt,deadline,'a second disconnect must not extend the first grace window');
  pair.room.disconnectedAt=Date.now()-301; f.app.tick(); assert.equal(f.app.rooms.has(pair.room.code),false);
});
