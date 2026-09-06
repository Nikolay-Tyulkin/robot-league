import type { Input, MatchState, RobotKind } from './sim';
export type RoomInfo = { code: string; player: number; players: { name: string; kind: RobotKind; ready: boolean; connected: boolean }[]; private: boolean };
export type ServerMessage =
  | { type: 'room'; room: RoomInfo; token: string }
  | { type: 'queued' }
  | { type: 'state'; state: MatchState; player: number }
  | { type: 'error'; message: string }
  | { type: 'info'; message: string }
  | { type: 'pong'; sent: number };

export class GameSocket {
  private ws?: WebSocket;
  private token?: string;
  private code?: string;
  private intentional = false;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private connectTimeout?: ReturnType<typeof setTimeout>;
  private reconnectUntil = 0;
  private pending?: object;
  constructor(private onMessage: (message: ServerMessage) => void, private onStatus: (text: string) => void, private onConnection: (connected: boolean) => void = () => {}) {}
  connect(initial: object) { this.pending = initial; this.intentional = false; this.reconnectUntil = 0; this.open(); }
  private open() {
    const configured = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
    const address = configured || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
    this.onStatus(this.token ? 'Rejoining your match…' : 'Connecting to Robot League…');
    const ws = new WebSocket(address); this.ws = ws;
    const active = () => this.ws === ws && !this.intentional;
    let lastReceived = Date.now(), lastPing = 0, resuming = !!this.token;
    this.connectTimeout = setTimeout(() => { if (active() && ws.readyState !== WebSocket.OPEN) { ws.onclose = null; ws.close(); disconnected(); } }, 6000);
    ws.onopen = () => {
      if (!active()) return;
      this.onConnection(true);
      clearTimeout(this.connectTimeout); this.onStatus('Connected');
      if (this.token && this.code) this.send({ type: 'resume', code: this.code, token: this.token });
      else if (this.pending) this.send(this.pending);
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (!active()) return;
        const now = Date.now();
        if (now - lastReceived > 8000) { ws.onclose = ws.onmessage = null; ws.close(); disconnected(); return; }
        if (now - lastPing > 3000) { this.send({ type: 'ping', sent: now }); lastPing = now; }
      }, 1000);
    };
    ws.onmessage = e => {
      if (!active()) return;
      lastReceived = Date.now();
      let message: ServerMessage; try { message = JSON.parse(e.data); } catch { return; }
      if (message.type === 'room') { this.code = message.room.code; this.token = message.token; this.reconnectUntil = 0; resuming = false; }
      if (resuming && message.type === 'error') { this.close(); this.onMessage(message); return; }
      this.onMessage(message);
    };
    const disconnected = () => {
      if (!active()) return;
      this.onConnection(false);
      clearTimeout(this.connectTimeout); if (this.heartbeat) clearInterval(this.heartbeat);
      if (this.token) {
        if (!this.reconnectUntil) this.reconnectUntil = Date.now() + 14500;
        if (Date.now() < this.reconnectUntil) { this.onStatus('Connection lost. Reconnecting…'); this.retry = setTimeout(() => this.open(), 1200); return; }
      }
      this.onMessage({ type: 'error', message: this.token ? 'Unable to rejoin the match. Please reconnect.' : 'Match server unavailable. You can still play solo.' });
    };
    ws.onclose = disconnected;
    ws.onerror = () => { /* onclose reports the actionable error once */ };
  }
  send(message: object) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message)); }
  selectRobot(kind: RobotKind) { this.send({ type: 'select-robot', kind }); }
  get connected() { return !this.intentional && this.ws?.readyState === WebSocket.OPEN; }
  input(input: Input) { this.send({ type: 'input', input }); }
  close() {
    this.intentional = true;
    this.onConnection(false);
    if (this.retry) clearTimeout(this.retry); if (this.heartbeat) clearInterval(this.heartbeat); clearTimeout(this.connectTimeout);
    this.send({ type: 'leave' });
    if (this.ws) { this.ws.onopen = this.ws.onmessage = this.ws.onclose = null; this.ws.close(); }
    this.ws = undefined; this.token = undefined; this.code = undefined;
  }
}

