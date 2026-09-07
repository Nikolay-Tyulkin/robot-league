import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { createMatch, step, finish, idleInput, isRobotKind, type Input, type MatchState, type Phase, type RobotKind } from '../game/sim.ts';
import { pathToFileURL } from 'node:url';
import { staticHandler } from './static.ts';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

type Seat = { ws: WebSocket | null; token: string; name: string; kind: RobotKind; ready: boolean; input: Input; lastSeen: number; lastInput: number; rematch: boolean };
type Room = { code: string; private: boolean; seats: Seat[]; state?: MatchState; resumePhase?: Phase; disconnectedAt?: number; updatedAt: number };
type Client = { room?: Room; seat?: number; queued?: boolean; presence?: boolean; name?: string; kind?: RobotKind; messages: number; window: number; actions: number; actionWindow: number; ip: string };
export function allowedOrigin(origin: string | undefined, host: string | undefined, allowlist?: string[]) {
  if (!origin) return !allowlist?.length;
  if (allowlist?.length) return allowlist.includes(origin);
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && url.host === host; }
  catch { return false; }
}
const connectionLimit = (value: string | undefined, fallback: number) => {
  const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};
export function validInput(value: unknown): value is Input {
  if (!value || typeof value !== 'object') return false;
  const i = value as Input;
  return Number.isSafeInteger(i.seq) && i.seq >= 0 && Number.isFinite(i.x) && Number.isFinite(i.z) && Math.abs(i.x) <= 1 && Math.abs(i.z) <= 1 && ['sprint','charge','shoot','tap'].every(k => typeof i[k as keyof Input] === 'boolean') && (i.skill === undefined || typeof i.skill === 'boolean');
}
export function createGameServer(options: { port?: number; host?: string; reconnectMs?: number; allowedOrigins?: string[]; autoTick?: boolean; staticDirectory?: string } = {}) {
  const rooms = new Map<string, Room>(), clients = new Map<WebSocket, Client>(), queue: WebSocket[] = [];
  const ipCounts = new Map<string, number>();
  const maxConnections = connectionLimit(process.env.MAX_CONNECTIONS, 512);
  const maxPerIp = connectionLimit(process.env.MAX_CONNECTIONS_PER_IP, 64);
  let stopping = false;
  const alive = new WeakMap<WebSocket, boolean>();
  const reconnectMs = options.reconnectMs ?? 15000;
  const send = (ws: WebSocket | null, data: object) => { if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(JSON.stringify(data)); };
  const onlineVisitors = () => [...clients.values()].filter(client => client.presence).length;
  const broadcastPresence = () => { const message = {type:'presence',online:onlineVisitors(),queued:queue.length}; for (const [ws, client] of clients) if (client.presence) send(ws, message); };
  const error = (ws: WebSocket, message: string) => send(ws, { type:'error', message });
  const serveStatic = options.staticDirectory ? staticHandler(options.staticDirectory) : undefined;
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({status:'ok',rooms:rooms.size,queued:queue.length,online:onlineVisitors()})); }
    else if (serveStatic) void serveStatic(req, res);
    else { res.writeHead(404); res.end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin, ip = req.socket.remoteAddress ?? 'unknown';
    const allowed = options.allowedOrigins ?? process.env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean);
    if (stopping || req.url !== '/ws' || !allowedOrigin(origin, req.headers.host, allowed) || wss.clients.size >= maxConnections || (ipCounts.get(ip) ?? 0) >= maxPerIp) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  function removeQueue(ws: WebSocket) { const index = queue.indexOf(ws); if (index >= 0) queue.splice(index, 1); const c = clients.get(ws); if (c) c.queued = false; if (index >= 0) broadcastPresence(); }
  function removeRoom(room: Room) {
    for (const s of room.seats) { const c = s.ws ? clients.get(s.ws) : undefined; if (c?.room === room) { c.room = undefined; c.seat = undefined; } }
    rooms.delete(room.code);
  }
  function broadcastRoom(room: Room) {
    room.updatedAt = Date.now();
    room.seats.forEach((s,i) => send(s.ws, {type:'room', token:s.token, room:{code:room.code,player:i,private:room.private,players:room.seats.map(p => ({name:p.name,kind:p.kind,ready:p.ready,connected:p.ws?.readyState === WebSocket.OPEN}))}}));
  }
  function snapshot(room: Room) { if (room.state) room.seats.forEach((s,i) => send(s.ws, {type:'state',state:room.state,player:i})); }
  function seat(ws: WebSocket, name: string, kind: RobotKind): Seat { return { ws, name, kind, token:randomBytes(24).toString('base64url'), ready:false, input:idleInput(), lastSeen:Date.now(), lastInput:Date.now(), rematch:false }; }
  function makeRoom(ws: WebSocket, name: string, kind: RobotKind, isPrivate: boolean) {
    let code: string; do { code = randomBytes(4).toString('hex').slice(0,6).toUpperCase(); } while (rooms.has(code));
    const room: Room = {code,private:isPrivate,seats:[seat(ws,name,kind)],updatedAt:Date.now()}; rooms.set(code,room);
    Object.assign(clients.get(ws)!, {room,seat:0}); broadcastRoom(room); return room;
  }
  function join(room: Room, ws: WebSocket, name: string, kind: RobotKind = room.seats[0].kind === 'watti' ? 'microduck' : 'watti') {
    if (room.seats.length >= 2 || room.state) { error(ws,'This room is full.'); return; }
    if (room.disconnectedAt!==undefined && Date.now()-room.disconnectedAt>reconnectMs) { error(ws,'Room not found or invitation expired.'); return; }
    room.seats.push(seat(ws,name,kind));
    Object.assign(clients.get(ws)!, {room,seat:1}); broadcastRoom(room);
  }
  function begin(room: Room) {
    room.state = createMatch(room.seats[0].kind,room.seats.map(s => s.name),room.seats[1].kind);
    room.disconnectedAt = undefined;
    room.seats.forEach(s => { s.input = idleInput(); s.lastInput=Date.now(); s.rematch=false; }); snapshot(room);
  }
  function leave(ws: WebSocket, disconnect: boolean) {
    removeQueue(ws); const c = clients.get(ws); if (!c?.room || c.seat === undefined) return;
    const room = c.room, p = room.seats[c.seat]; if (p.ws !== ws) return;
    p.ws=null; p.lastSeen=Date.now(); p.input=idleInput();
    if (!room.state) {
      if (disconnect) {
        // Keep occupied seats and their choices available to the existing resume-token flow.
        room.disconnectedAt ??= Date.now();
        room.seats.forEach(s=>{s.ready=false;}); broadcastRoom(room);
      } else {
        room.seats.forEach(s => send(s.ws,{type:'error',message:'Your opponent left. Start a new match.'}));
        removeRoom(room);
      }
    } else if (room.state.phase !== 'finished') {
      if (disconnect) {
        if (room.state.phase !== 'paused') room.resumePhase=room.state.phase;
        room.state.phase='paused'; room.disconnectedAt ??= Date.now(); snapshot(room);
      } else { finish(room.state, c.seat === 0 ? 1 : 0); snapshot(room); }
    }
    c.room=undefined; c.seat=undefined;
  }
  wss.on('connection', (ws, req) => {
    alive.set(ws, true); ws.on('pong', () => alive.set(ws, true));
    const ip=req.socket.remoteAddress ?? 'unknown'; ipCounts.set(ip,(ipCounts.get(ip)??0)+1);
    clients.set(ws,{messages:0,window:Date.now(),actions:0,actionWindow:Date.now(),ip});
    ws.on('message', raw => {
      const c=clients.get(ws)!; const now=Date.now();
      if(now-c.window>1000) {c.messages=0;c.window=now;} if(++c.messages>100) {ws.close(1008,'Rate limit');return;}
      let m: Record<string,unknown>; try { const buffer = Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof ArrayBuffer ? Buffer.from(raw) : raw; m=JSON.parse(buffer.toString('utf8')); } catch {error(ws,'Invalid message.');return;}
      if(!m || typeof m!=='object' || typeof m.type!=='string') {error(ws,'Invalid message.');return;}
      if(m.type==='ping') {send(ws,{type:'pong',sent:typeof m.sent==='number'&&Number.isFinite(m.sent)?m.sent:0});return;}
      if(m.type==='presence') { if (!c.presence) { c.presence=true; broadcastPresence(); } return; }
      if(m.type==='input') {
        if(!c.room?.state || c.seat===undefined || !validInput(m.input)) return;
        const p=c.room.seats[c.seat], i=m.input;
        if(i.seq<=p.input.seq) return;
        // Preserve edge-triggered actions until the next simulation tick consumes them.
        p.input={seq:i.seq,x:i.x,z:i.z,sprint:i.sprint,charge:i.charge,shoot:i.shoot||p.input.shoot,tap:i.tap||p.input.tap,skill:i.skill===true||p.input.skill===true}; p.lastInput=now; return;
      }
      if(now-c.actionWindow>10000) {c.actions=0;c.actionWindow=now;} if(++c.actions>20) {error(ws,'Too many requests. Please wait a moment.');return;}
      if(m.type==='leave') {leave(ws,false);return;}
      if(m.type==='resume') {
        if(c.room) return;
        const room=typeof m.code==='string'?rooms.get(m.code):undefined;
        if(!room || typeof m.token!=='string') {error(ws,'The match has ended or the server has restarted.');return;}
        const index=room.seats.findIndex(s => {const a=Buffer.from(s.token),b=Buffer.from(m.token as string);return a.length===b.length&&timingSafeEqual(a,b);});
        if(index<0 || (room.disconnectedAt && now-room.disconnectedAt>reconnectMs)) {error(ws,'The reconnection window has expired.');return;}
        const p=room.seats[index]; if(p.ws && p.ws!==ws) {error(ws,'This player is already connected.');return;}
        p.ws=ws;p.lastSeen=now;p.lastInput=now;p.input=idleInput();Object.assign(c,{room,seat:index});
        // A resumed browser may begin a fresh input sequence; gameplay timers persist.
        if(room.state) {room.state.players[index].skillSeq=-1;room.state.players[index].skillHeld=false;}
        if(!room.state && room.seats.every(s=>s.ws?.readyState===WebSocket.OPEN)) room.disconnectedAt=undefined;
        if(room.state?.phase==='paused' && room.seats.every(s=>s.ws?.readyState===WebSocket.OPEN)) {room.state.phase=room.resumePhase??'play';room.disconnectedAt=undefined;}
        broadcastRoom(room);snapshot(room);return;
      }
      if(m.type==='select-robot') {
        if(!c.room || c.seat===undefined) {error(ws,'Join a room before choosing a robot.');return;}
        if(c.room.state) {error(ws,'Robot choices are locked after the match starts.');return;}
        if(!isRobotKind(m.kind)) {error(ws,'Choose an available robot.');return;}
        // The socket owns its seat; client-supplied player/seat fields cannot target another player.
        const player=c.room.seats[c.seat];
        if(player.kind!==m.kind) {
          player.kind=m.kind;
          // Both players must confirm the changed pairing before a match can begin.
          c.room.seats.forEach(s=>{s.ready=false;});
        }
        broadcastRoom(c.room);return;
      }
      if(m.type==='ready' && c.room && c.seat!==undefined) {
        if(c.room.state) return;
        c.room.seats[c.seat].ready=true;broadcastRoom(c.room);
        if(c.room.seats.length===2 && c.room.seats.every(s=>s.ready&&s.ws?.readyState===WebSocket.OPEN)) begin(c.room);return;
      }
      if(m.type==='rematch' && c.room?.state?.phase==='finished' && c.seat!==undefined) {
        c.room.seats[c.seat].rematch=true;
        c.room.seats.forEach(s=>send(s.ws,{type:'info',message:'Rematch requested. Select “Rematch” to play again.'}));
        if(c.room.seats.every(s=>s.rematch&&s.ws?.readyState===WebSocket.OPEN)) begin(c.room);return;
      }
      if(!['queue','create','join'].includes(m.type)) return;
      if(c.room || c.queued) {error(ws,'You are already in a room or in the queue.');return;}
      const name=typeof m.name==='string'?Array.from(m.name).filter(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127).join('').trim().slice(0,20):'Player';
      const selectedKind = isRobotKind(m.kind) ? m.kind : undefined;
      const nick=name||'Player', kind=selectedKind??'watti';
      if(m.type==='create') {if(rooms.size>=200) {error(ws,'All arenas are busy. Please try again later.');return;} makeRoom(ws,nick,kind,true);}
      if(m.type==='join') {
        const room=typeof m.code==='string'?rooms.get(m.code.toUpperCase()):undefined;
        if(!room) {error(ws,'Room not found or invitation expired.');return;} join(room,ws,nick,selectedKind);
      }
      if(m.type==='queue') {
        removeQueue(ws); let opponent:WebSocket|undefined;
        while(queue.length) {const candidate=queue.shift()!;if(candidate.readyState===WebSocket.OPEN&&!clients.get(candidate)?.room) {opponent=candidate;break;}}
        if(opponent) {
          const other=clients.get(opponent)!;other.queued=false;
          const room=makeRoom(opponent,other.name||'Player',other.kind??'watti',false); join(room,ws,nick,kind);
        } else {c.queued=true;c.name=nick;c.kind=kind;queue.push(ws);send(ws,{type:'queued'});}
        broadcastPresence();
      }
    });
    ws.on('close',()=>{leave(ws,true);clients.delete(ws);broadcastPresence();const n=(ipCounts.get(ip)??1)-1;if(n)ipCounts.set(ip,n);else ipCounts.delete(ip);});
    ws.on('error',()=>{});
  });
  let ticks=0;
  function tick() {
    const now=Date.now();ticks++;
    for(const room of rooms.values()) {
      if(!room.state) {
        const reconnectExpired=room.disconnectedAt!==undefined && now-room.disconnectedAt>reconnectMs;
        if(reconnectExpired || now-room.updatedAt>10*60*1000) {room.seats.forEach(s=>send(s.ws,{type:'error',message:'This room has expired.'}));removeRoom(room);}
        continue;
      }
      if(room.disconnectedAt && now-room.disconnectedAt>reconnectMs && room.state.phase==='paused') {
        const connected=room.seats.map(s=>s.ws?.readyState===WebSocket.OPEN);finish(room.state,connected[0]&&!connected[1]?0:connected[1]&&!connected[0]?1:null);room.disconnectedAt=undefined;snapshot(room);
      }
      const inputs=room.seats.map(p=>{if(now-p.lastInput>350)p.input={...idleInput(),seq:p.input.seq};return p.input;}) as [Input,Input];
      const wasFinished = room.state.phase === 'finished';
      step(room.state,inputs);
      if (!wasFinished && room.state.phase === 'finished') room.updatedAt = now;
      room.seats.forEach(p=>{p.input.shoot=false;p.input.tap=false;p.input.skill=false;});
      if(ticks%3===0) snapshot(room);
      if(room.seats.every(s=>!s.ws)&&now-Math.max(...room.seats.map(s=>s.lastSeen))>reconnectMs) removeRoom(room);
      else if (room.state.phase === 'finished' && now - room.updatedAt > 10 * 60 * 1000) removeRoom(room);
    }
  }
  // Interval callbacks are integer milliseconds; accumulate monotonic time for a true 60 Hz simulation.
  let previousTime = performance.now(), accumulated = 0;
  const timer=options.autoTick===false?undefined:setInterval(() => {
    const now = performance.now(); accumulated += Math.min((now - previousTime) / 1000, .25); previousTime = now;
    while (accumulated >= 1 / 60) { tick(); accumulated -= 1 / 60; }
  },8);
  const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!alive.get(ws)) { ws.terminate(); continue; } alive.set(ws, false); ws.ping(); } }, 4000);
  heartbeat.unref();
  server.on('close',()=>{if(timer)clearInterval(timer);clearInterval(heartbeat);});
  const listen=async () => {
    if (options.staticDirectory) await access(resolve(options.staticDirectory, 'index.html'));
    return new Promise<number>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??Number(process.env.PORT??8080),options.host??process.env.HOST??'127.0.0.1',()=>{server.removeListener('error',reject);resolve((server.address() as {port:number}).port);});});
  };
  let closing: Promise<void> | undefined;
  const close=() => closing ??= new Promise<void>(resolve=>{
    stopping=true;if(timer)clearInterval(timer);clearInterval(heartbeat);
    for(const ws of wss.clients)ws.close(1001,'Server shutting down');
    const force=setTimeout(()=>{for(const ws of wss.clients)ws.terminate();server.closeAllConnections();},3000);force.unref();
    wss.close();server.close(()=>{clearTimeout(force);resolve();});
  });
  return {server,wss,rooms,queue,tick,listen,close};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const app=createGameServer({staticDirectory:process.env.STATIC_DIR});const port=await app.listen();console.log(`Robot League listening on ${process.env.HOST ?? '127.0.0.1'}:${port}`);
  const stop=()=>void app.close().then(()=>process.exit(0));process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

