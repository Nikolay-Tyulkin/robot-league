import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiInput, createMatch, FIELD, idleInput, ROBOT_KINDS, step, type GameEvent, type Input, type MatchState, type Player } from '../game/sim.ts';
import { decodeInput, encodeInput, SnapshotDecoder, SnapshotEncoder, WIRE_PROTOCOL } from '../game/wire.ts';

function roundtrip(encoder: SnapshotEncoder, decoder: SnapshotDecoder, state: MatchState, player = 0) {
  const before = structuredClone(state), bytes = encoder.encode(state, player), decoded = decoder.decode(bytes);
  assert.deepEqual(decoded, { type: 'state', state: before, player });
  assert.deepEqual(state, before, 'encoding leaves the authoritative simulation untouched');
  return { bytes, decoded: decoded! };
}
function writeU32(bytes: Uint8Array, offset: number, value: number) { new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true); }
function writeNumber(bytes: Uint8Array, offset: number, value: number) { new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setFloat64(offset, value, true); }

void test('binary input is exact for analog axes, safe sequence IDs, optional skill and every button combination', () => {
  assert.equal(WIRE_PROTOCOL, 'robot-league.v2');
  for (let flags = 0; flags < 32; flags++) {
    const input: Input = { seq: Number.MAX_SAFE_INTEGER - flags, x: Math.sin(flags), z: -Math.cos(flags), sprint: !!(flags & 1), charge: !!(flags & 2), shoot: !!(flags & 4), tap: !!(flags & 8), skill: !!(flags & 16) };
    const bytes = encodeInput(input); assert.equal(bytes.length, 29); assert.deepEqual(decodeInput(bytes), input);
    const padded = new Uint8Array(bytes.length + 12); padded.set(bytes, 7);
    assert.deepEqual(decodeInput(padded.subarray(7, 7 + bytes.length)), input, 'honors typed array byte offsets');
    assert.deepEqual(decodeInput(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), input);
  }
  for (const input of [{ ...idleInput(), seq: -0, x: -0, z: Number.MIN_VALUE }, { ...idleInput(), skill: undefined }]) assert.deepEqual(decodeInput(encodeInput(input)), input);
  const absent = idleInput(); delete absent.skill;
  assert.deepEqual(decodeInput(encodeInput(absent)), absent);
});

void test('binary input rejects malformed flags, directions, sequence IDs, trailing data and nonfinite values', () => {
  const good = encodeInput(idleInput());
  for (let size = 0; size < good.length; size++) assert.equal(decodeInput(good.slice(0, size)), null);
  assert.equal(decodeInput(new Uint8Array([...good, 0])), null);
  for (const [offset, values] of [[0, [0]], [2, [1, 3]], [3, [2, 3, 255]], [4, [16, 64, 112, 128, 255]]] as const) {
    for (const value of values) { const bad = good.slice(); bad[offset] = value; assert.equal(decodeInput(bad), null); }
  }
  for (const seq of [-1, 1.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    const bad = good.slice(); writeNumber(bad, 5, seq); assert.equal(decodeInput(bad), null);
  }
  for (const offset of [13, 21]) for (const value of [-1.001, 1.001, NaN, -Infinity]) {
    const bad = good.slice(); writeNumber(bad, offset, value); assert.equal(decodeInput(bad), null);
  }
  assert.throws(() => encodeInput({ ...idleInput(), seq: -1 }));
  assert.throws(() => encodeInput({ ...idleInput(), x: NaN }));
  assert.throws(() => encodeInput({ ...idleInput(), skill: 1 } as unknown as Input));
});

void test('snapshot fields roundtrip exactly, preserve Unicode and retain independent snapshots', () => {
  const state = createMatch('reachy', ['Робот🤖漢字', 'Odd\ud83d'], 'reachy');
  state.phase = 'play'; state.time = 1 / 3; state.phaseTime = Number.MIN_VALUE; state.ball.x = -0; state.ball.spin = Number.MAX_VALUE;
  state.players[0].skillSeq = Number.MAX_SAFE_INTEGER; state.players[1].ack = Number.MAX_SAFE_INTEGER;
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
  const first = roundtrip(encoder, decoder, state).decoded;
  const firstCopy = structuredClone(first);
  for (const player of state.players) {
    for (const key of Object.keys(player) as (keyof Player)[]) {
      if (typeof player[key] === 'number' && !['id', 'ack', 'skillSeq'].includes(key)) (player as unknown as Record<string, unknown>)[key] = Math.PI / (key.length + 1);
    }
    player.ack = 7; player.skillSeq = 5; player.skillHeld = true; player.contacted = true; player.action = 'tap';
  }
  Object.assign(state, { tick: 99, phase: 'goal', phaseTime: .1, time: 2 / 3, overtime: true, eventId: 5, winner: 1, lastScorer: 0 });
  state.score = [3, 4];
  for (const key of Object.keys(state.ball) as (keyof MatchState['ball'])[]) state.ball[key] = -Math.PI / (key.length + 1);
  state.events = [{ id: 5, type: 'goal', player: -0, x: -0, z: Number.MIN_VALUE }];
  const second = roundtrip(encoder, decoder, state).decoded;
  assert.deepEqual(first, firstCopy, 'subsequent decoding does not mutate earlier snapshots');
  second.state.players[0].x = 1000; second.state.score[0] = 1000; second.state.events[0].z = 1000;
  roundtrip(encoder, decoder, state);
  for (const phase of ['countdown', 'play', 'goal', 'paused', 'finished'] as const) {
    state.phase = phase; state.players[0].action = 'kick'; roundtrip(encoder, decoder, state);
  }
  state.winner = -0; state.lastScorer = -0; roundtrip(encoder, decoder, state);
});

void test('unchanged fields and retained events consume no value bytes, with exact signed-zero changes', () => {
  const state = createMatch(), encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
  state.events = [{ id: 1, type: 'start', player: -1, x: 0, z: 0 }]; state.eventId = 1;
  roundtrip(encoder, decoder, state);
  const unchanged = roundtrip(encoder, decoder, state).bytes;
  assert.equal(unchanged.length, 24, 'only header, masks and empty event append are sent');
  state.ball.x = -0;
  assert.equal(roundtrip(encoder, decoder, state).bytes.length, unchanged.length + 8);
  assert.equal(roundtrip(encoder, decoder, state).bytes.length, unchanged.length);
});

void test('bounded event history supports suffix eviction, all event kinds, large jumps and changed events', () => {
  const state = createMatch(), encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
  roundtrip(encoder, decoder, state);
  const types: GameEvent['type'][] = ['kick', 'goal', 'start', 'finish', 'bounce', 'skill'];
  for (let i = 1; i <= 70; i++) {
    state.events.push({ id: i, type: types[i % types.length], player: i % 3 - 1, x: i / 7, z: -i / 11 });
    state.eventId = i; state.events = state.events.slice(-24); roundtrip(encoder, decoder, state);
  }
  state.events[0].x = .12345678912345678; roundtrip(encoder, decoder, state);
  state.events = [{ id: 500, type: 'skill', player: 1, x: -0, z: .2 }]; state.eventId = 500; roundtrip(encoder, decoder, state);
  state.events = []; roundtrip(encoder, decoder, state);
});

void test('keyframes cover cadence, explicit resync, reconnect, seat/identity changes and rematches', () => {
  let state = createMatch(); const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
  for (let frame = 1; frame <= 82; frame++) {
    const { bytes } = roundtrip(encoder, decoder, state);
    assert.equal(bytes[3], (frame - 1) % 40 === 0 ? 2 : 3); state.tick++;
  }
  encoder.reset(); assert.equal(roundtrip(encoder, decoder, state).bytes[3], 2);
  assert.equal(roundtrip(encoder, decoder, state, 1).bytes[3], 2);
  state.players[0].kind = 'reachy'; state.players[1].kind = 'reachy';
  assert.equal(roundtrip(encoder, decoder, state, 1).bytes[3], 2);
  state.players[1].name = 'New player'; assert.equal(roundtrip(encoder, decoder, state, 1).bytes[3], 2);
  state = createMatch('reachy', undefined, 'reachy'); assert.equal(roundtrip(encoder, decoder, state, 1).bytes[3], 2);
  decoder.reset(); assert.equal(roundtrip(new SnapshotEncoder(), decoder, state).bytes[3], 2);
});

void test('truncation, bad enums, nonfinite fields and replay never poison the last valid baseline', () => {
  const state = createMatch(), encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
  const full = encoder.encode(state, 0);
  for (let size = 0; size < full.length; size++) assert.equal(decoder.decode(full.slice(0, size)), null);
  for (const [offset, value] of [[0, 0], [2, 7], [3, 1], [12, 2], [21, 255], [38, 2]]) {
    const bad = full.slice(); bad[offset] = value; assert.equal(decoder.decode(bad), null);
  }
  for (const value of [NaN, Infinity, -Infinity, -1, .5, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = full.slice(); writeNumber(bad, 13, value); assert.equal(decoder.decode(bad), null);
  }
  assert.equal(decoder.decode(new Uint8Array(65537)), null);
  assert.equal(decoder.decode(new Uint8Array([...full, 0])), null);
  assert.ok(decoder.decode(full)); assert.equal(decoder.decode(full), null);
  state.tick++; state.players[0].x = 1 / 7; const delta = encoder.encode(state, 0);
  for (let size = 0; size < delta.length; size++) assert.equal(decoder.decode(delta.slice(0, size)), null);
  const badBase = delta.slice(); writeU32(badBase, 8, 999); assert.equal(decoder.decode(badBase), null);
  const badFrame = delta.slice(); writeU32(badFrame, 4, 99); assert.equal(decoder.decode(badFrame), null);
  const badMask = delta.slice(); badMask[14] = 255; assert.equal(decoder.decode(badMask), null);
  assert.deepEqual(decoder.decode(delta)?.state, state);
  assert.equal(decoder.decode(full), null); assert.equal(decoder.decode(delta), null);
});

void test('missing delta baseline recovers on a fresh keyframe, and malformed event bounds are rejected', () => {
  const state = createMatch(), encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
  const full = encoder.encode(state, 0), second = encoder.encode(state, 0), third = encoder.encode(state, 0);
  assert.equal(decoder.decode(second), null); assert.ok(decoder.decode(full)); assert.equal(decoder.decode(third), null);
  const badDrop = second.slice(); badDrop[22] = 1; assert.equal(decoder.decode(badDrop), null);
  const badCount = second.slice(); badCount[23] = 25; assert.equal(decoder.decode(badCount), null);
  assert.ok(decoder.decode(second)); encoder.reset(); roundtrip(encoder, decoder, state);
  state.events = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, type: 'start' as const, player: -1, x: 0, z: 0 })); state.eventId = 25;
  assert.throws(() => encoder.encode(state, 0)); state.events = [];
  roundtrip(encoder, decoder, state, 0);
  state.players[0].name = '🤖'.repeat(21); assert.throws(() => encoder.encode(state, 0));
  state.players[0].name = '🤖'.repeat(20); roundtrip(encoder, decoder, state, 0);
});

void test('60 Hz simulation streams remain exact through skills, goals, mirror matches and rematches at less than 40% JSON bytes', t => {
  let binaryBytes = 0, jsonBytes = 0, snapshots = 0, inputs = 0, jsonInputBytes = 0;
  const seenEvents = new Set<string>();
  for (const kind of ROBOT_KINDS) {
    const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
    for (let match = 0; match < 2; match++) {
      const state = createMatch(kind, ['Player Alpha', 'Игрок Beta'], kind); state.phase = 'play';
      state.players[0].x = -.55; state.players[1].x = .55;
      for (let tick = 0; tick < 720; tick++) {
        const commands: [Input, Input] = [aiInput(state, 0), aiInput(state, 1)];
        if (tick === 0) commands.forEach(input => { input.skill = true; input.seq = 1; });
        if (tick === 540) { state.ball.x = FIELD.x; state.ball.z = 0; state.ball.y = FIELD.radius; state.ball.vx = 20; state.ball.vz = 0; }
        step(state, commands);
        if (tick % 2 === 0) {
          for (const input of commands) { assert.deepEqual(decodeInput(encodeInput(input)), input); inputs++; jsonInputBytes += Buffer.byteLength(JSON.stringify({ type: 'input', input })); }
        }
        if (tick % 3 !== 0) continue;
        const { bytes } = roundtrip(encoder, decoder, state, 1);
        binaryBytes += bytes.length; jsonBytes += Buffer.byteLength(JSON.stringify({ type: 'state', state, player: 1 })); snapshots++;
        state.events.forEach(event => seenEvents.add(event.type));
      }
    }
  }
  assert.ok(seenEvents.has('skill')); assert.ok(seenEvents.has('goal'));
  assert.ok(binaryBytes / jsonBytes < .4, `snapshot ratio ${binaryBytes / jsonBytes}`);
  t.diagnostic(`${snapshots} snapshots: binary ${binaryBytes} B, JSON ${jsonBytes} B, ratio ${(binaryBytes / jsonBytes).toFixed(4)}, average ${(binaryBytes / snapshots).toFixed(1)} B vs ${(jsonBytes / snapshots).toFixed(1)} B. ${inputs} inputs: ${inputs * 29} B vs ${jsonInputBytes} B.`);
});
