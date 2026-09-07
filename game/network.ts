import type { Input, MatchState, RobotKind } from './sim';
import { encodeInput, SnapshotDecoder, WIRE_PROTOCOL } from './wire';

export type RoomInfo = { code: string; player: number; players: { name: string; kind: RobotKind; ready: boolean; connected: boolean }[]; private: boolean };
export type ArenaPresence = { type: 'presence'; online: number; queued: number; inGame: number; waiting: number; admitted: number; capacity: number };
export type AdmissionInfo = Omit<ArenaPresence, 'type'> & { type: 'admission'; status: 'waiting' | 'ready' | 'active'; ticket: string; position: number; expiresAt: number | null; retryAfterMs: number };
export type ServerMessage =
  | { type: 'room'; room: RoomInfo; token: string }
  | { type: 'queued' }
  | { type: 'state'; state: MatchState; player: number }
  | { type: 'error'; message: string }
  | { type: 'info'; message: string }
  | { type: 'pong'; sent: number }
  | ArenaPresence
  | AdmissionInfo;

export function gameServerAddress() {
  const configured = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  return configured || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

function httpAddress(path: string) {
  const url = new URL(gameServerAddress());
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = path; url.search = ''; url.hash = '';
  return url.toString();
}

let fallbackVisitorId: string | undefined;
let latestAdmissionAttempt: symbol | undefined;
function visitorId() {
  if (fallbackVisitorId) return fallbackVisitorId;
  // Duplicated tabs copy sessionStorage. Each page needs its own admission identity.
  fallbackVisitorId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
  return fallbackVisitorId;
}

const jitter = (delay: number) => Math.round(delay * (0.9 + Math.random() * 0.2));
function validStats(value: ArenaPresence) {
  return ['online', 'queued', 'inGame', 'waiting', 'admitted', 'capacity'].every(key => Number.isSafeInteger(value[key as keyof Omit<ArenaPresence, 'type'>]) && value[key as keyof Omit<ArenaPresence, 'type'>] >= 0);
}

export function subscribeArenaPresence(onChange: (online: number | null, queued: number | null, stats?: ArenaPresence | null) => void) {
  let retry: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined, stopped = false, failures = 0;
  const beat = async () => {
    if (stopped) return;
    const controller = new AbortController(); request = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    let delay = 15000;
    try {
      const response = await fetch(httpAddress('/presence'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: visitorId() }), signal: controller.signal });
      if (!response.ok) throw new Error('Presence unavailable');
      const stats = await response.json() as ArenaPresence;
      if (stats.type !== 'presence' || !validStats(stats)) throw new Error('Invalid presence');
      if (!stopped) { failures = 0; onChange(stats.online, stats.queued, stats); }
    } catch {
      delay = Math.min(60000, 2000 * 2 ** Math.min(failures++, 5));
      if (!stopped) onChange(null, null, null);
    } finally {
      clearTimeout(timeout);
      if (!stopped) retry = setTimeout(() => { void beat(); }, jitter(delay));
    }
  };
  void beat();
  return () => { stopped = true; clearTimeout(retry); request?.abort(); };
}

function cancelAdmission(ticket: string) {
  void fetch(httpAddress('/admission'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', ticket }), keepalive: true }).catch(() => {});
}

export class GameSocket {
  private ws?: WebSocket;
  private token?: string;
  private code?: string;
  private ticket?: string;
  private intentional = true;
  private generation = 0;
  private attempt?: symbol;
  private request?: AbortController;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private connectTimeout?: ReturnType<typeof setTimeout>;
  private reconnectUntil = 0;
  private failures = 0;
  private pending?: object;
  private decoder = new SnapshotDecoder();
  private pagehide = () => this.close();
  constructor(private onMessage: (message: ServerMessage) => void, private onStatus: (text: string) => void, private onConnection: (connected: boolean) => void = () => {}) {}

  connect(initial: object) {
    this.close(); this.pending = initial; this.intentional = false; this.reconnectUntil = 0; this.failures = 0;
    this.attempt = latestAdmissionAttempt = Symbol('admission');
    window.addEventListener('pagehide', this.pagehide);
    this.onStatus('Checking for a multiplayer spot…');
    void this.admit(this.generation);
  }

  private active(generation: number) { return !this.intentional && this.generation === generation; }

  private async admit(generation: number) {
    if (!this.active(generation)) return;
    const controller = new AbortController(), attempt = this.attempt;
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const body = this.ticket ? { action: 'poll', ticket: this.ticket } : { action: 'join', visitorId: visitorId() };
      const response = await fetch(httpAddress('/admission'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!this.active(generation)) {
        if (response.ok && latestAdmissionAttempt === attempt) {
          const stale = await response.json() as AdmissionInfo;
          if (stale.ticket) cancelAdmission(stale.ticket);
        }
        return;
      }
      if (response.status === 404) { this.ticket = undefined; this.retryAdmission(generation); return; }
      if (response.status === 503) { this.fail('The waiting list is full. Please try again soon, or play solo.'); return; }
      if (!response.ok) throw new Error('Admission unavailable');
      const admission = await response.json() as AdmissionInfo;
      if (!this.active(generation)) { if (latestAdmissionAttempt === attempt && admission.ticket) cancelAdmission(admission.ticket); return; }
      if (admission.type !== 'admission' || !admission.ticket || !['waiting', 'ready', 'active'].includes(admission.status) || !validStats({ ...admission, type: 'presence' })) throw new Error('Invalid admission');
      this.ticket = admission.ticket;
      this.onMessage(admission);
      if (!this.active(generation)) return;
      if (admission.status === 'waiting') {
        this.failures = 0;
        this.onStatus('Your spot is saved. We’ll connect you automatically.');
        this.retry = setTimeout(() => { void this.admit(generation); }, jitter(Math.max(2000, Math.min(5000, admission.retryAfterMs || 2500))));
      } else this.open(generation);
    } catch {
      if (this.active(generation)) this.retryAdmission(generation);
    } finally { clearTimeout(timeout); if (this.request === controller) this.request = undefined; }
  }

  private retryAdmission(generation: number) {
    if (!this.active(generation)) return;
    if (++this.failures > 5) { this.fail('Match server unavailable. You can still play solo.'); return; }
    this.onStatus('Connection interrupted. Checking your multiplayer spot…');
    this.retry = setTimeout(() => { void this.admit(generation); }, jitter(Math.min(10000, 1000 * 2 ** (this.failures - 1))));
  }

  private fail(message: string) { this.close(); this.onMessage({ type: 'error', message }); }

  private open(generation: number) {
    if (!this.active(generation) || !this.ticket) return;
    this.onStatus(this.token ? 'Rejoining your match…' : 'Connecting to Robot League…');
    const ws = new WebSocket(gameServerAddress(), [WIRE_PROTOCOL, `admission.${this.ticket}`]); this.ws = ws;
    ws.binaryType = 'arraybuffer'; this.decoder.reset();
    const active = () => this.active(generation) && this.ws === ws;
    let lastReceived = Date.now(), lastPing = 0, lastResync = -Infinity, resuming = !!this.token;
    const disconnected = () => {
      if (!active()) return;
      ws.onopen = ws.onmessage = ws.onclose = null; this.ws = undefined;
      this.onConnection(false);
      clearTimeout(this.connectTimeout); clearInterval(this.heartbeat);
      if (this.token) {
        if (!this.reconnectUntil) this.reconnectUntil = Date.now() + 14500;
        if (Date.now() < this.reconnectUntil) { this.onStatus('Connection lost. Reconnecting…'); this.retry = setTimeout(() => this.open(generation), 1200); return; }
        this.fail('Unable to rejoin the match. Please reconnect.');
      } else {
        if (this.ticket) cancelAdmission(this.ticket);
        this.ticket = undefined; this.retryAdmission(generation);
      }
    };
    this.connectTimeout = setTimeout(() => { if (active() && ws.readyState !== WebSocket.OPEN) { disconnected(); ws.close(); } }, 6000);
    ws.onopen = () => {
      if (!active()) return;
      this.onConnection(true);
      clearTimeout(this.connectTimeout); this.onStatus('Connected');
      if (this.token && this.code) this.send({ type: 'resume', code: this.code, token: this.token });
      else if (this.pending) this.send(this.pending);
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (!active()) return;
        const now = Date.now();
        if (now - lastReceived > 8000) { disconnected(); ws.close(); return; }
        if (now - lastPing > 3000) { this.send({ type: 'ping', sent: now }); lastPing = now; }
      }, 1000);
    };
    ws.onmessage = e => {
      if (!active()) return;
      lastReceived = Date.now();
      let message: ServerMessage;
      if (e.data instanceof ArrayBuffer) {
        const decoded = this.decoder.decode(e.data);
        if (!decoded) { if (Date.now() - lastResync > 1000) { lastResync = Date.now(); this.send({ type: 'resync' }); } return; }
        message = decoded;
      } else {
        try { message = JSON.parse(e.data); } catch { return; }
      }
      if (message.type === 'room') { this.code = message.room.code; this.token = message.token; this.reconnectUntil = 0; this.failures = 0; resuming = false; }
      if (message.type === 'queued') this.failures = 0;
      if (resuming && message.type === 'error') { this.close(); this.onMessage(message); return; }
      this.onMessage(message);
    };
    ws.onclose = disconnected;
    ws.onerror = () => { /* onclose handles reconnects and actionable errors. */ };
  }

  send(message: object) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message)); }
  selectRobot(kind: RobotKind) { this.send({ type: 'select-robot', kind }); }
  get connected() { return !this.intentional && this.ws?.readyState === WebSocket.OPEN; }
  input(input: Input) {
    if (!this.connected || !this.ws) return;
    if (this.ws.protocol === WIRE_PROTOCOL) this.ws.send(encodeInput(input));
    else this.send({ type: 'input', input });
  }
  close() {
    this.intentional = true; this.generation++;
    this.onConnection(false);
    window.removeEventListener('pagehide', this.pagehide);
    this.request?.abort(); this.request = undefined;
    clearTimeout(this.retry); clearInterval(this.heartbeat); clearTimeout(this.connectTimeout);
    this.send({ type: 'leave' });
    if (this.ws) { this.ws.onopen = this.ws.onmessage = this.ws.onclose = null; this.ws.close(); }
    if (this.ticket) cancelAdmission(this.ticket);
    this.ws = undefined; this.token = undefined; this.code = undefined; this.ticket = undefined; this.pending = undefined;
    this.decoder.reset();
  }
}
