import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const base = new URL(process.argv[2] || 'http://localhost:3000');
for (const path of ['/healthz', '/', '/models/watti/model.glb', '/models/microduck/model.glb', '/models/reachy/model.glb', '/models/watti/NOTICE.md', '/models/reachy/NOTICE.md', '/licenses/THIRD_PARTY.txt', '/audio/garage-theme-01.mp3', '/audio/garage-theme-02.mp3']) {
  const response = await fetch(new URL(path, base), {signal: AbortSignal.timeout(15000)});
  assert.equal(response.status, 200, path);
  if (path.endsWith('.glb')) {
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.subarray(0,4).toString(), 'glTF', path);
    assert.equal(body.readUInt32LE(8), body.length, `Incomplete GLB: ${path}`);
  } else if (path.endsWith('.mp3')) {
    assert.match(response.headers.get('content-type') ?? '', /audio\/mpeg/);
    assert.equal((await response.arrayBuffer()).byteLength, path.endsWith('01.mp3') ? 4991903 : 5356593);
  } else if (path === '/') assert.match(await response.text(), /Robot League/);
  else await response.arrayBuffer();
  console.log(`HTTP OK ${path}`);
}
const address = new URL('/ws', base); address.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
const peers = [];
async function connect() {
  const ws = new WebSocket(address, {origin: base.origin, handshakeTimeout:10000});
  const messages = [], listeners = new Set();
  ws.on('message', raw => { messages.push(JSON.parse(raw.toString())); listeners.forEach(fn => fn()); });
  const peer = {
    ws, send: message => ws.send(JSON.stringify(message)),
    wait: (type, predicate = () => true) => new Promise((resolve,reject) => {
      const timeout=setTimeout(()=>{listeners.delete(check);reject(new Error(`No ${type} message`));},10000);
      const check=()=>{const i=messages.findIndex(m=>m.type===type && predicate(m));if(i>=0){clearTimeout(timeout);listeners.delete(check);resolve(messages.splice(i,1)[0]);}};
      listeners.add(check);check();
    }),
  };
  peers.push(peer);
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  return peer;
}
try {
  const a=await connect(),b=await connect();
  a.send({type:'create',name:'Smoke A',kind:'reachy'}); const created=await a.wait('room');
  b.send({type:'join',name:'Smoke B',kind:'reachy',code:created.room.code}); const joined=await b.wait('room');
  assert.equal(joined.room.players.length,2);assert.equal(joined.room.code,created.room.code);
  assert.deepEqual(joined.room.players.map(player => player.kind), ['reachy', 'reachy']);
  a.send({type:'ready'}); await a.wait('room', m=>m.room.players[0].ready);
  a.send({type:'select-robot',kind:'watti'});
  const changed=await b.wait('room',m=>m.room.players[0].kind==='watti');
  assert.deepEqual(changed.room.players.map(player=>player.ready),[false,false]);
  a.send({type:'select-robot',kind:'reachy'});
  await b.wait('room',m=>m.room.players.every(player=>player.kind==='reachy') && m.room.players.every(player=>!player.ready));
  a.send({type:'ready'});b.send({type:'ready'});
  const [first,second]=await Promise.all([a.wait('state'),b.wait('state')]);
  assert.equal(first.state.players.length,2);assert.equal(second.state.phase,'countdown');
  assert.deepEqual(first.state.players.map(player => player.kind), ['reachy', 'reachy']);
  a.send({type:'ping',sent:42});assert.equal((await a.wait('pong')).sent,42);
  console.log('WebSocket OK: two players changed lobby robots, cleared readiness, started a Reachy mirror match and received state/pong.');
} finally {
  for(const peer of peers) {if(peer.ws.readyState===WebSocket.OPEN)peer.send({type:'leave'});peer.ws.close();}
}
