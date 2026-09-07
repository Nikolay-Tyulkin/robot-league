import { ROBOT_KINDS, type Ball, type GameEvent, type Input, type MatchState, type Player } from './sim.ts';

export const WIRE_PROTOCOL = 'robot-league.v2';
const VERSION = 2, INPUT = 1, KEYFRAME = 2, DELTA = 3;
const MAX_PACKET = 64 * 1024, MAX_EVENTS = 24, MAX_NAME_BYTES = 80, KEYFRAME_INTERVAL = 40;
type Bytes = ArrayBuffer | Uint8Array;
type Scalar = number | string | boolean | null;
type Codec = 'number' | 'boolean' | 'name' | readonly Scalar[];

// Schema order is part of protocol v2. These exhaustive maps make additions to
// simulation types a compile error until their wire representation is defined.
const matchFields = {
  tick: 'number', phase: ['countdown', 'play', 'goal', 'finished', 'paused'], phaseTime: 'number', time: 'number',
  overtime: 'boolean', eventId: 'number', winner: [null, 0, 1, -0], lastScorer: [null, 0, 1, -0],
} as const satisfies Record<keyof Omit<MatchState, 'score' | 'players' | 'ball' | 'events'>, Codec>;
const playerFields = {
  id: 'number', kind: ROBOT_KINDS, name: 'name', x: 'number', z: 'number', vx: 'number', vz: 'number',
  yaw: 'number', distance: 'number', charge: 'number', energy: 'number', cooldown: 'number', kickClearance: 'number',
  skillCooldown: 'number', skillTime: 'number', blinded: 'number', staggered: 'number', skillHeld: 'boolean',
  skillSeq: 'number', action: ['none', 'kick', 'tap'], actionTime: 'number', actionPower: 'number', contacted: 'boolean', ack: 'number',
} as const satisfies Record<keyof Player, Codec>;
const ballFields = { x: 'number', y: 'number', z: 'number', vx: 'number', vy: 'number', vz: 'number', spin: 'number' } as const satisfies Record<keyof Ball, Codec>;
const eventFields = { id: 'number', type: ['kick', 'goal', 'start', 'finish', 'bounce', 'skill'], player: [-1, 0, 1, -0], x: 'number', z: 'number' } as const satisfies Record<keyof GameEvent, Codec>;
const scoreFields = { 0: 'number', 1: 'number' } as const;
const utf8 = new TextEncoder();
type Fields<T> = readonly (readonly [keyof T, Codec])[];
function fields<T extends object>(schema: Record<keyof T, Codec>): Fields<T> {
  const entries = Object.entries(schema) as [keyof T, Codec][];
  requireValid(entries.length <= 31); return entries;
}
const matchSchema = fields(matchFields), playerSchema = fields(playerFields), ballSchema = fields(ballFields), eventSchema = fields(eventFields), scoreSchema = fields(scoreFields);

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid Robot League packet');
}

class Writer {
  private bytes: Uint8Array;
  private view: DataView;
  private offset = 0;
  constructor(capacity = 512) { this.bytes = new Uint8Array(capacity); this.view = new DataView(this.bytes.buffer); }
  private reserve(size: number) {
    const needed = this.offset + size; requireValid(needed <= MAX_PACKET);
    if (needed <= this.bytes.length) return;
    const bytes = new Uint8Array(Math.min(MAX_PACKET, Math.max(needed, this.bytes.length * 2)));
    bytes.set(this.bytes); this.bytes = bytes; this.view = new DataView(bytes.buffer);
  }
  u8(value: number) { this.reserve(1); this.view.setUint8(this.offset, value); this.offset++; }
  u16(value: number) { this.reserve(2); this.view.setUint16(this.offset, value, true); this.offset += 2; }
  u32(value: number) { this.reserve(4); this.view.setUint32(this.offset, value, true); this.offset += 4; }
  number(value: number) { requireValid(Number.isFinite(value)); this.reserve(8); this.view.setFloat64(this.offset, value, true); this.offset += 8; }
  result() { return this.bytes.slice(0, this.offset); }
}

class Reader {
  private view: DataView;
  private offset = 0;
  constructor(bytes: Bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    requireValid(data.byteLength <= MAX_PACKET);
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u8() { const value = this.view.getUint8(this.offset); this.offset++; return value; }
  u16() { const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u32() { const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  number() { const value = this.view.getFloat64(this.offset, true); this.offset += 8; requireValid(Number.isFinite(value)); return value; }
  done() { requireValid(this.offset === this.view.byteLength); }
}

function writeHeader(w: Writer, kind: number) { w.u8(0x52); w.u8(0x4c); w.u8(VERSION); w.u8(kind); }
function readHeader(r: Reader) { requireValid(r.u8() === 0x52 && r.u8() === 0x4c && r.u8() === VERSION); return r.u8(); }

function writeScalar(w: Writer, codec: Codec, value: Scalar) {
  if (codec === 'number') { requireValid(typeof value === 'number'); w.number(value); }
  else if (codec === 'boolean') { requireValid(typeof value === 'boolean'); w.u8(value ? 1 : 0); }
  else if (codec === 'name') {
    requireValid(typeof value === 'string' && value.length <= MAX_NAME_BYTES && utf8.encode(value).length <= MAX_NAME_BYTES);
    // UTF-16 also preserves a lone surrogate left by the existing nickname
    // length limit. UTF-8 TextEncoder would silently replace that code unit.
    w.u8(value.length);
    for (let i = 0; i < value.length; i++) w.u16(value.charCodeAt(i));
  } else { const index = codec.findIndex(item => Object.is(item, value)); requireValid(index >= 0); w.u8(index); }
}
function readScalar(r: Reader, codec: Codec): Scalar {
  if (codec === 'number') return r.number();
  if (codec === 'boolean') { const value = r.u8(); requireValid(value <= 1); return value === 1; }
  if (codec === 'name') {
    const count = r.u8(); requireValid(count <= MAX_NAME_BYTES);
    let value = '';
    for (let i = 0; i < count; i++) value += String.fromCharCode(r.u16());
    requireValid(utf8.encode(value).length <= MAX_NAME_BYTES);
    return value;
  }
  const index = r.u8(); requireValid(index < codec.length); return codec[index];
}

function writeFields<T extends object>(w: Writer, schema: Fields<T>, current: T, previous?: T) {
  // Each v2 object has at most 24 fields, so one integer holds its change mask.
  let mask = (1 << schema.length) - 1;
  if (previous) {
    mask = 0;
    for (let i = 0; i < schema.length; i++) { const key = schema[i][0]; if (!Object.is(current[key], previous[key])) mask |= 1 << i; }
    for (let start = 0; start < schema.length; start += 8) w.u8((mask >>> start) & 255);
  }
  for (let i = 0; i < schema.length; i++) if (mask & (1 << i)) writeScalar(w, schema[i][1], current[schema[i][0]] as Scalar);
}
function readFields<T extends object>(r: Reader, schema: Fields<T>, target: T, delta: boolean) {
  let mask = (1 << schema.length) - 1;
  if (delta) {
    mask = 0;
    for (let start = 0; start < schema.length; start += 8) {
      const byte = r.u8(), bits = Math.min(8, schema.length - start);
      requireValid(byte < 2 ** bits); mask |= byte << start;
    }
  }
  for (let i = 0; i < schema.length; i++) if (mask & (1 << i)) target[schema[i][0]] = readScalar(r, schema[i][1]) as T[keyof T];
}

function copyState(s: MatchState): MatchState {
  return { ...s, score: [...s.score], players: [{ ...s.players[0] }, { ...s.players[1] }], ball: { ...s.ball }, events: s.events.map(e => ({ ...e })) };
}
function integer(value: number, minimum = 0) { return Number.isSafeInteger(value) && value >= minimum; }
function validateState(s: MatchState) {
  requireValid(integer(s.tick) && integer(s.eventId) && s.score.length === 2 && s.score.every(n => integer(n)));
  requireValid(s.players.length === 2 && s.players.every((p, i) => p.id === i && integer(p.ack) && integer(p.skillSeq, -1)));
  requireValid(s.events.length <= MAX_EVENTS);
  let lastId = 0;
  for (const event of s.events) { requireValid(integer(event.id, 1) && event.id > lastId && event.id <= s.eventId); lastId = event.id; }
}
function eventEqual(a: GameEvent, b: GameEvent) {
  for (const [key] of eventSchema) if (!Object.is(a[key], b[key])) return false;
  return true;
}
function writeEvents(w: Writer, events: GameEvent[], previous?: GameEvent[]) {
  let keep = 0;
  if (previous) {
    for (let n = Math.min(events.length, previous.length); n > 0; n--) {
      if (events[0].id !== previous[previous.length - n].id) continue;
      let equal = true;
      for (let i = 0; i < n; i++) if (!eventEqual(events[i], previous[previous.length - n + i])) { equal = false; break; }
      if (equal) { keep = n; break; }
    }
    w.u8(previous.length - keep);
  }
  w.u8(events.length - keep);
  for (let i = keep; i < events.length; i++) writeFields(w, eventSchema, events[i]);
}
function readEvents(r: Reader, previous?: GameEvent[]): GameEvent[] {
  let kept: GameEvent[] = [];
  if (previous) { const drop = r.u8(); requireValid(drop <= previous.length); kept = previous.slice(drop); }
  const count = r.u8(); requireValid(count + kept.length <= MAX_EVENTS);
  for (let i = 0; i < count; i++) { const event = {} as GameEvent; readFields(r, eventSchema, event, false); kept.push(event); }
  return kept;
}

function validInput(input: Input) {
  return integer(input.seq) && Number.isFinite(input.x) && Math.abs(input.x) <= 1 && Number.isFinite(input.z) && Math.abs(input.z) <= 1
    && ['sprint', 'charge', 'shoot', 'tap'].every(key => typeof input[key as keyof Input] === 'boolean')
    && (input.skill === undefined || typeof input.skill === 'boolean');
}

export function encodeInput(input: Input): Uint8Array {
  requireValid(validInput(input));
  const w = new Writer(29); writeHeader(w, INPUT);
  const skillPresent = Object.hasOwn(input, 'skill');
  const flags = Number(input.sprint) | Number(input.charge) << 1 | Number(input.shoot) << 2 | Number(input.tap) << 3
    | Number(input.skill === true) << 4 | Number(skillPresent) << 5 | Number(skillPresent && input.skill === undefined) << 6;
  w.u8(flags); w.number(input.seq); w.number(input.x); w.number(input.z);
  return w.result();
}

export function decodeInput(bytes: Bytes): Input | null {
  try {
    const r = new Reader(bytes); requireValid(readHeader(r) === INPUT);
    const flags = r.u8();
    requireValid(flags < 128 && (!(flags & 16) || (flags & 32)) && (!(flags & 64) || ((flags & 32) && !(flags & 16))));
    const input: Input = { seq: r.number(), x: r.number(), z: r.number(), sprint: !!(flags & 1), charge: !!(flags & 2), shoot: !!(flags & 4), tap: !!(flags & 8) };
    if (flags & 32) input.skill = flags & 64 ? undefined : !!(flags & 16);
    r.done(); requireValid(validInput(input)); return input;
  } catch { return null; }
}

export class SnapshotEncoder {
  private previous?: MatchState;
  private player?: number;
  private frame = 0;
  private sinceKeyframe = 0;

  // Retain frame numbering on the same socket so a requested resync cannot be
  // mistaken for replay. A new connection gets a new encoder and decoder.
  reset() { this.previous = undefined; this.player = undefined; this.sinceKeyframe = 0; }

  // Call only once a socket has passed its send/backpressure checks: encoding
  // advances the baseline that the next delta references.
  encode(state: MatchState, player: number): Uint8Array {
    requireValid(player === 0 || player === 1); validateState(state);
    const previous = this.previous;
    const identityChanged = previous && state.players.some((p, i) => p.id !== previous.players[i].id || p.kind !== previous.players[i].kind || p.name !== previous.players[i].name);
    const full = !previous || this.player !== player || this.sinceKeyframe >= KEYFRAME_INTERVAL - 1 || identityChanged
      || state.tick < previous.tick || state.eventId < previous.eventId;
    const frame = this.frame + 1; requireValid(frame <= 0xffffffff);
    const w = new Writer(); writeHeader(w, full ? KEYFRAME : DELTA); w.u32(frame); w.u32(full ? 0 : this.frame); w.u8(player);
    const base = full ? undefined : previous;
    writeFields(w, matchSchema, state, base); writeFields<{ '0': number; '1': number }>(w, scoreSchema, state.score, base?.score);
    for (const id of [0, 1]) writeFields(w, playerSchema, state.players[id], base?.players[id]);
    writeFields(w, ballSchema, state.ball, base?.ball); writeEvents(w, state.events, base?.events);
    const bytes = w.result();
    this.previous = copyState(state); this.player = player; this.frame = frame; this.sinceKeyframe = full ? 0 : this.sinceKeyframe + 1;
    return bytes;
  }
}

export class SnapshotDecoder {
  private previous?: MatchState;
  private player?: number;
  private frame = 0;

  reset() { this.previous = undefined; this.player = undefined; this.frame = 0; }

  decode(bytes: Bytes): { type: 'state'; state: MatchState; player: number } | null {
    try {
      const r = new Reader(bytes), kind = readHeader(r); requireValid(kind === KEYFRAME || kind === DELTA);
      const frame = r.u32(), base = r.u32(), player = r.u8(), delta = kind === DELTA;
      requireValid(frame > this.frame && (player === 0 || player === 1));
      requireValid(delta ? !!this.previous && base === this.frame && frame === base + 1 && player === this.player : base === 0);
      const state = delta ? copyState(this.previous!) : { score: [0, 0], players: [{}, {}], ball: {} } as MatchState;
      readFields(r, matchSchema, state, delta); readFields<{ '0': number; '1': number }>(r, scoreSchema, state.score, delta);
      for (const id of [0, 1]) readFields(r, playerSchema, state.players[id], delta);
      readFields(r, ballSchema, state.ball, delta); state.events = readEvents(r, delta ? state.events : undefined);
      r.done(); validateState(state);
      // Neither malformed frames nor consumers mutating a returned snapshot can
      // alter the baseline used to reconstruct future authoritative snapshots.
      this.previous = copyState(state); this.player = player; this.frame = frame;
      return { type: 'state', state, player };
    } catch { return null; }
  }
}
