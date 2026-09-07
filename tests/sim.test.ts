import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step, idleInput, aiInput, FIELD, ROBOT_KINDS, ROBOT_NAMES, isRobotKind, selectSoloOpponent, SKILL_COOLDOWN, REACHY_VAULT_DURATION, MICRODUCK_TRIP_RANGE, playerMovementSpeed, isVaulting, type MatchState, type Input, type RobotKind } from '../game/sim.ts';
const playing = () => { const s=createMatch();s.phase='play';return s; };
const advance=(s:MatchState,seconds:number)=>{for(let i=0;i<seconds*60;i++)step(s,[idleInput(),idleInput()]);};
const skillMatch = (kind: RobotKind, opponent: RobotKind = 'watti') => {
  const s = createMatch(kind, undefined, opponent); s.phase = 'play';
  Object.assign(s.players[0], { x: 0, z: 0, yaw: Math.PI / 2 });
  Object.assign(s.players[1], { x: 1.1, z: 0, yaw: -Math.PI / 2 });
  Object.assign(s.ball, { x: -3, z: 3 });
  return s;
};

void test('Flash affects a nearby opponent ahead for 1.2 seconds without disabling human movement', () => {
  const s = skillMatch('watti');
  step(s, [{ ...idleInput(), seq: 1, skill: true }, { ...idleInput(), z: 1 }]);
  assert.equal(s.players[1].blinded, 1.2); assert.ok(s.players[1].vz > 0);
  assert.equal(s.players[0].skillCooldown, SKILL_COOLDOWN);
  assert.equal(playerMovementSpeed(s.players[1], idleInput()), 3.25);
  assert.deepEqual(s.events.map(e => [e.type, e.player, e.x, e.z]), [['skill', 0, 0, 0]]);
  const blindAI = aiInput(s, 1);
  assert.equal(blindAI.x, 0); assert.equal(blindAI.z, 0);
  assert.equal(blindAI.shoot, false); assert.equal(blindAI.skill, false);
  advance(s, 1.22); assert.equal(s.players[1].blinded, 0);
});

void test('Flash and Trip miss behind, beside and beyond their cones but still consume cooldown', () => {
  for (const kind of ['watti', 'microduck'] as const) {
    for (const position of [{ x: -1.1, z: 0 }, { x: 0, z: 1.1 }, { x: kind === 'watti' ? 2.61 : MICRODUCK_TRIP_RANGE + .01, z: 0 }]) {
      const s = skillMatch(kind); Object.assign(s.players[1], position);
      step(s, [{ ...idleInput(), seq: 1, skill: true }, idleInput()]);
      assert.equal(s.players[1].blinded, 0, `${kind} flash must miss ${JSON.stringify(position)}`);
      assert.equal(s.players[1].staggered, 0, `${kind} trip must miss ${JSON.stringify(position)}`);
      assert.equal(s.players[0].skillCooldown, 10);
    }
  }
});

void test('Trip reaches an opponent just inside its wider 1.5 metre front range', () => {
  const s = skillMatch('microduck'); Object.assign(s.players[1], { x: MICRODUCK_TRIP_RANGE - .01, z: 0 });
  step(s, [{ ...idleInput(), seq: 1, skill: true }, idleInput()]);
  assert.equal(s.players[1].staggered, .55);
});

void test('Trip slows immediately, interrupts pending kicks and briefly blocks shooting and skills', () => {
  const s = skillMatch('microduck'), target = s.players[1];
  Object.assign(target, { action: 'kick', actionTime: .18, actionPower: 1, charge: .8, vx: 3.25 });
  step(s, [{ ...idleInput(), seq: 1, skill: true }, { ...idleInput(), seq: 1, x: 1, shoot: true, charge: true }]);
  assert.equal(target.staggered, .55); assert.equal(target.action, 'none'); assert.equal(target.charge, 0);
  assert.ok(target.vx <= 3.25 * .35 + .000001); assert.ok(target.vx >= 0, 'a trip must not knock back');
  assert.equal(playerMovementSpeed(target, idleInput()), 3.25 * .35);
  step(s, [idleInput(), { ...idleInput(), seq: 2, skill: true, tap: true }]);
  assert.equal(target.action, 'none'); assert.equal(target.skillCooldown, 0);
  advance(s, .56); assert.equal(target.staggered, 0);
  step(s, [idleInput(), { ...idleInput(), seq: 3, skill: true }]);
  assert.equal(target.skillCooldown, 10, 'a fresh press works after recovering');
});

void test('simultaneous skills are evaluated fairly for both seat orders and Vault evades ground skills', () => {
  const mirror = skillMatch('microduck', 'microduck');
  step(mirror, [{ ...idleInput(), seq: 1, skill: true }, { ...idleInput(), seq: 1, skill: true }]);
  assert.deepEqual(mirror.players.map(p => p.staggered), [.55, .55]);
  assert.deepEqual(mirror.players.map(p => p.skillCooldown), [10, 10]);
  for (const kind of ['watti', 'microduck'] as const) for (const seat of [0, 1]) {
    const s = skillMatch(seat === 0 ? 'reachy' : kind, seat === 0 ? kind : 'reachy');
    step(s, [{ ...idleInput(), seq: 1, skill: true }, { ...idleInput(), seq: 1, skill: true }]);
    assert.equal(s.players[seat].blinded, 0); assert.equal(s.players[seat].staggered, 0);
    assert.equal(isVaulting(s.players[seat]), true);
  }
});

void test('Vault crosses an opponent smoothly without striking or carrying a ball, then restores collision', () => {
  const s = skillMatch('reachy');
  const p = s.players[0], opponent = s.players[1], start = { x: opponent.x, z: opponent.z };
  // The grounded opponent is just outside ball contact; the vault crosses it.
  Object.assign(s.ball, { x: .55, z: -.35 });
  const ballStart = { x: s.ball.x, z: s.ball.z };
  step(s, [{ ...idleInput(), seq: 1, skill: true, shoot: true, charge: true }, idleInput()]);
  assert.equal(p.skillTime, REACHY_VAULT_DURATION); assert.equal(p.action, 'none'); assert.equal(p.charge, 0);
  let previous = p.x;
  for (let i = 0; i < 36; i++) {
    step(s, [{ ...idleInput(), seq: i + 2, z: 1, shoot: true, charge: true }, idleInput()]);
    assert.ok(p.x - previous <= 3.4 / 60 + .000001); previous = p.x;
    assert.equal(p.yaw, Math.PI / 2, 'steering cannot change direction in midair');
    assert.equal(p.action, 'none');
  }
  assert.ok(p.x > opponent.x + .92); assert.ok(p.x < 2.3);
  assert.deepEqual({ x: opponent.x, z: opponent.z }, start);
  assert.deepEqual({ x: s.ball.x, z: s.ball.z }, ballStart);
  advance(s, .15); assert.equal(isVaulting(p), false);
  assert.ok(Math.hypot(p.x - opponent.x, p.z - opponent.z) >= FIELD.player * 2 - .000001);
});

void test('Vault stays inside walls and resolves a landing overlap beside the board', () => {
  const s = skillMatch('reachy');
  Object.assign(s.players[0], { x: FIELD.x - FIELD.player - 1.7, z: 2.5 });
  Object.assign(s.players[1], { x: FIELD.x - FIELD.player, z: 2.5 });
  step(s, [{ ...idleInput(), seq: 1, skill: true }, idleInput()]);
  for (let i = 0; i < 48; i++) {
    step(s, [idleInput(), idleInput()]);
    for (const p of s.players) assert.ok(Math.abs(p.x) <= FIELD.x - FIELD.player && Math.abs(p.z) <= FIELD.z - FIELD.player);
  }
  assert.equal(isVaulting(s.players[0]), false);
  assert.ok(Math.hypot(s.players[0].x - s.players[1].x, s.players[0].z - s.players[1].z) >= FIELD.player * 2 - .000001);
});

void test('all skills require a fresh press and sequence and cannot repeat through the ten-second cooldown', () => {
  for (const kind of ROBOT_KINDS) {
    const s = createMatch(kind); s.phase = 'play';
    for (let seq = 1; seq <= 620; seq++) step(s, [{ ...idleInput(), seq, skill: true }, idleInput()]);
    assert.equal(s.events.filter(e => e.type === 'skill').length, 1, `${kind}: holding must not auto-cast`);
    assert.equal(s.players[0].skillCooldown, 0);
    step(s, [{ ...idleInput(), seq: 621 }, idleInput()]);
    step(s, [{ ...idleInput(), seq: 620, skill: true }, idleInput()]);
    assert.equal(s.events.filter(e => e.type === 'skill').length, 1, 'an old sequence cannot replay an edge');
    step(s, [{ ...idleInput(), seq: 622 }, idleInput()]);
    step(s, [{ ...idleInput(), seq: 623, skill: true }, idleInput()]);
    assert.equal(s.events.filter(e => e.type === 'skill').length, 2);
    advance(s, 1);
    step(s, [{ ...idleInput(), seq: 624, skill: true }, idleInput()]);
    assert.equal(s.events.filter(e => e.type === 'skill').length, 2, 'new edges cannot bypass cooldown');
  }
});

void test('skills freeze on pause, clear effects after a goal and retain cooldown until a new match', () => {
  const s = skillMatch('watti'); step(s, [{ ...idleInput(), seq: 1, skill: true }, idleInput()]);
  s.phase = 'paused'; const paused = structuredClone(s); advance(s, 2); assert.deepEqual(s, paused);
  s.phase = 'play'; Object.assign(s.ball, { x: 7.7, z: 0, vx: 15, vz: 0 });
  advance(s, .03); assert.equal(s.phase, 'goal');
  for (const p of s.players) assert.deepEqual([p.skillTime, p.blinded, p.staggered], [0, 0, 0]);
  const cooldown = s.players[0].skillCooldown; advance(s, 3);
  assert.equal(s.phase, 'countdown'); assert.equal(s.players[0].skillCooldown, cooldown);
  const fresh = createMatch();
  for (const p of fresh.players) assert.deepEqual([p.skillCooldown, p.skillTime, p.blinded, p.staggered], [0, 0, 0, 0]);
});

void test('skills pressed during countdown do not arm at kickoff and AI uses only tactical available skills', () => {
  const s = skillMatch('watti'); s.phase = 'countdown'; s.phaseTime = .01;
  step(s, [{ ...idleInput(), seq: 1, skill: true }, idleInput()]);
  step(s, [{ ...idleInput(), seq: 2, skill: true }, idleInput()]);
  assert.equal(s.players[0].skillCooldown, 0); assert.equal(s.events.some(e => e.type === 'skill'), false);
  for (const kind of ROBOT_KINDS) {
    const match = skillMatch(kind); Object.assign(match.ball, { x: kind === 'reachy' ? 2.3 : 1.5, z: 0 });
    assert.equal(aiInput(match, 0).skill, true, `${kind} should use a tactical opportunity`);
    match.players[0].skillCooldown = .1; assert.equal(aiInput(match, 0).skill, false);
  }
});
void test('full crossing scores once, mirrored for both goals',()=>{
  for(const side of [-1,1]){const s=playing();s.ball.x=side*7.5;s.ball.vx=side*18;advance(s,.1);assert.equal(s.score[side>0?0:1],1);advance(s,1);assert.equal(s.score[side>0?0:1],1);}
});
void test('diagonal full-ball crossing is evaluated at the goal plane',()=>{
  const s=playing();Object.assign(s.ball,{x:7.725,z:1.27,y:.18,vx:6,vz:4,vy:0});step(s,[idleInput(),idleInput()]);assert.equal(s.score[0],1);
});
void test('high and wide shots bounce rather than count',()=>{
  for(const pos of [{z:2,y:.18},{z:0,y:2.1}]){const s=playing();Object.assign(s.ball,{x:7.38,vx:22,...pos});advance(s,.1);assert.deepEqual(s.score,[0,0]);assert.ok(s.ball.x<FIELD.x);assert.ok(s.ball.vx<0);}
});
void test('a goal before the final whistle can equalise and start extra time',()=>{
  const s=playing();s.time=.005;s.score=[0,1];Object.assign(s.ball,{x:7.76,z:0,y:.18,vx:15,vz:0,vy:0});step(s,[idleInput(),idleInput()]);assert.deepEqual(s.score,[1,1]);assert.equal(s.overtime,true);assert.equal(s.time,60);
});
void test('fifth goal and sudden death finish, tied overtime is a draw',()=>{
  for(const overtime of [false,true]){const s=playing();s.overtime=overtime;s.score=overtime?[0,0]:[4,1];s.ball.x=7.7;s.ball.vx=15;advance(s,.1);assert.equal(s.phase,'finished');assert.equal(s.winner,0);}
  const tie=playing();tie.overtime=true;tie.time=.01;advance(tie,.1);assert.equal(tie.phase,'finished');assert.equal(tie.winner,null);
});
void test('kick contact happens once after its wind-up',()=>{
  const s=playing();s.players[0].x=-.78;s.players[0].yaw=Math.PI/2;step(s,[{...idleInput(),shoot:true},idleInput()]);assert.equal(s.events.filter(e=>e.type==='kick').length,0);advance(s,.25);assert.equal(s.events.filter(e=>e.type==='kick').length,1);advance(s,1);assert.equal(s.events.filter(e=>e.type==='kick').length,1);
});
void test('AI scores against a stationary opponent and recovers sideline balls',()=>{
  for(const z of [0,-4.4,4.4]){const s=playing();s.ball.z=z;for(let i=0;i<60*90&&!s.score[1];i++)step(s,[idleInput(),aiInput(s,1)]);assert.ok(s.score[1]>0,`AI failed at sideline ${z}`);}
});
void test('pause preserves state; invalid movement stays finite',()=>{
  const s=playing();s.phase='paused';const copy=JSON.stringify(s);advance(s,2);assert.equal(JSON.stringify(s),copy);s.phase='play';step(s,[{...idleInput(),x:Infinity,z:NaN},idleInput()]);assert.ok(s.players.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)&&Number.isFinite(p.yaw)));
});

void test('robot identity validation accepts all playable kinds and rejects untrusted values', () => {
  assert.deepEqual(ROBOT_KINDS, ['watti', 'microduck', 'reachy']);
  for (const kind of ROBOT_KINDS) { assert.equal(isRobotKind(kind), true); assert.ok(ROBOT_NAMES[kind]); }
  for (const value of [undefined, null, '', 'random', 'Reachy', '__proto__', 1, {}, ['reachy']]) assert.equal(isRobotKind(value), false);
});

void test('solo opponent selection preserves explicit choices and random excludes the player robot', () => {
  for (const kind of ROBOT_KINDS) {
    assert.equal(selectSoloOpponent(kind, kind, () => { throw new Error('Explicit choice must not sample randomness'); }), kind);
    for (let i = 0; i < ROBOT_KINDS.length - 1; i++) {
      const opponent = selectSoloOpponent('random', kind, () => (i + .5) / (ROBOT_KINDS.length - 1));
      const match = createMatch(kind, undefined, opponent);
      assert.notEqual(opponent, kind);
      assert.equal(match.players[0].kind, kind);
    }
  }
  assert.equal(selectSoloOpponent('random', 'watti', () => 0), 'microduck');
  assert.equal(selectSoloOpponent('random', 'watti', () => 1), 'reachy');
  assert.equal(selectSoloOpponent('random', 'watti', () => NaN), 'microduck');
});

void test('match initialization supports all nine pairings with independent players and correct names', () => {
  for (const kind of ROBOT_KINDS) for (const opponent of ROBOT_KINDS) {
    const match = createMatch(kind, undefined, opponent);
    assert.deepEqual(match.players.map(p => p.kind), [kind, opponent]);
    assert.deepEqual(match.players.map(p => p.name), [ROBOT_NAMES[kind], ROBOT_NAMES[opponent]]);
    assert.notEqual(match.players[0], match.players[1]);
    assert.deepEqual(match.players.map(p => p.id), [0, 1]);
    assert.ok(match.players[0].x < 0 && match.players[1].x > 0);
    assert.deepEqual(createMatch(kind, ['First', 'Second'], opponent).players.map(p => p.name), ['First', 'Second']);
  }
  assert.deepEqual(createMatch().players.map(p => p.kind), ['watti', 'microduck']);
  assert.deepEqual(createMatch('microduck').players.map(p => p.kind), ['microduck', 'watti']);
  assert.deepEqual(createMatch('reachy').players.map(p => p.kind), ['reachy', 'watti']);
});

void test('all playable kinds can score with the same AI and shared rules', () => {
  for (const kind of ROBOT_KINDS) {
    const match = createMatch(kind, undefined, kind); match.phase = 'play';
    for (let i = 0; i < 60 * 90 && !match.score[1]; i++) step(match, [idleInput(), aiInput(match, 1)]);
    assert.ok(match.score[1] > 0, `${kind} AI did not score`);
    assert.ok(match.players.every(p => Number.isFinite(p.x) && Number.isFinite(p.z)));
  }
});

function cornerRecovery(match: MatchState, id: number) {
  let ballEscapedAt: number | undefined, playerEscaped = false, attacked = false, tapped = false, lastEvent = 0;
  const clearOfCorner = (body: {x: number; z: number}) => Math.abs(body.x) < FIELD.x - 1.8 || Math.abs(body.z) < FIELD.z - 1.8;
  for (let tick = 0; tick < 15 * 60 && !attacked; tick++) {
    const controls = [idleInput(), idleInput()] as [ReturnType<typeof idleInput>, ReturnType<typeof idleInput>];
    controls[id] = aiInput(match, id); step(match, controls);
    const p = match.players[id];
    const contact = match.events.some(e => e.id > lastEvent && e.type === 'kick' && e.player === id);
    lastEvent = match.eventId;
    if (contact && p.action === 'tap') tapped = true;
    if (tapped && ballEscapedAt === undefined && clearOfCorner(match.ball)) ballEscapedAt = tick / 60;
    if (ballEscapedAt !== undefined && clearOfCorner(p)) playerEscaped = true;
    if (playerEscaped && contact && p.action === 'kick' && match.ball.vx * (id ? -1 : 1) > 2) attacked = true;
  }
  return { ballEscapedAt, playerEscaped, attacked, tapped };
}

void test('AI clears all four corners from wall approaches and jammed poses, then resumes attack on either team', () => {
  for (const kind of ROBOT_KINDS) for (const id of [0, 1]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (const pose of ['end-wall', 'sideline', 'diagonal', 'center', 'jammed']) {
      const match = createMatch(kind, undefined, kind); match.phase = 'play';
      const p = match.players[id], context = `${kind}, team ${id}, corner ${sx}/${sz}, ${pose}`;
      match.ball.x = sx * (FIELD.x - FIELD.radius - .01); match.ball.z = sz * (FIELD.z - FIELD.radius - .01);
      if (pose === 'end-wall') { p.x = sx * (FIELD.x - FIELD.player - .02); p.z = sz * (FIELD.z - 1.5); }
      else if (pose === 'sideline') { p.x = sx * (FIELD.x - 1.5); p.z = sz * (FIELD.z - FIELD.player - .02); }
      else if (pose === 'diagonal') { p.x = sx * (FIELD.x - 1.3); p.z = sz * (FIELD.z - 1.3); }
      else if (pose === 'jammed') {
        // Reproduce the settled stuck state: a player collision has pushed the
        // ball beyond the board constraint at the end of the previous substep.
        p.x = sx * (FIELD.x - FIELD.player); p.z = sz * (FIELD.z - FIELD.player);
        p.yaw = Math.atan2(sx, sz); match.ball.x = sx * 7.59; match.ball.z = sz * 4.59;
      }
      const result = cornerRecovery(match, id);
      assert.equal(result.tapped, true, `No deliberate clearance: ${context}`);
      assert.ok(result.ballEscapedAt !== undefined && result.ballEscapedAt < 8, `Ball remained in corner: ${context}`);
      assert.equal(result.playerEscaped, true, `AI remained in corner: ${context}`);
      assert.equal(result.attacked, true, `AI did not resume an attacking strike: ${context}`);
    }
  }
});

void test('AI corner recovery also clears balls near the transition back to normal attack', () => {
  for (const id of [0, 1]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (const [x, z] of [[6.55, 4.41], [7.41, 3.55], [6.95, 3.95]]) for (const endWall of [false, true]) {
      const match = createMatch('reachy', undefined, 'microduck'); match.phase = 'play';
      const p = match.players[id], context = `team ${id}, ball ${sx * x}/${sz * z}, end wall ${endWall}`;
      match.ball.x = sx * x; match.ball.z = sz * z;
      p.x = sx * (endWall ? 7.12 : 6.1); p.z = sz * (endWall ? 3.1 : 4.12);
      const result = cornerRecovery(match, id);
      assert.ok(result.ballEscapedAt !== undefined && result.ballEscapedAt < 10, `Ball remained near corner: ${context}`);
      assert.equal(result.playerEscaped, true, `AI remained near corner: ${context}`);
      assert.equal(result.attacked, true, `AI did not resume attack: ${context}`);
    }
  }
});

function humanCorner(sx: number, sz: number, striker: number, approach: 'diagonal' | 'end-wall' | 'sideline') {
  const match = createMatch('watti', undefined, 'reachy'); match.phase = 'play';
  Object.assign(match.ball, {x: sx * (FIELD.x - FIELD.radius - .01), z: sz * (FIELD.z - FIELD.radius - .01)});
  const p = match.players[striker], other = match.players[1 - striker];
  const controls: [Input, Input] = [idleInput(), idleInput()];
  if (approach === 'diagonal') {
    Object.assign(p, {x: sx * 6.5, z: sz * 3.5, yaw: Math.atan2(sx, sz)});
    Object.assign(controls[striker], {x: sx, z: sz});
  } else {
    const endWall = approach === 'end-wall';
    Object.assign(p, {x: sx * (endWall ? 7.12 : 6.32), z: sz * (endWall ? 3.32 : 4.12), yaw: Math.atan2(endWall ? 0 : sx, endWall ? sz : 0)});
    Object.assign(other, {x: sx * (endWall ? 6.32 : 7.12), z: sz * (endWall ? 4.12 : 3.32), yaw: Math.atan2(endWall ? sx : 0, endWall ? 0 : sz)});
    Object.assign(controls[striker], {x: endWall ? 0 : sx, z: endWall ? sz : 0});
    Object.assign(controls[1 - striker], {x: endWall ? sx : 0, z: endWall ? 0 : sz});
  }
  return {match, controls};
}

function assertInsideBoards(match: MatchState, context: string) {
  const ball = match.ball;
  assert.ok([ball.x, ball.y, ball.z, ball.vx, ball.vy, ball.vz].every(Number.isFinite), `Nonfinite ball: ${context}`);
  assert.ok(Math.abs(ball.z) <= FIELD.z - FIELD.radius + 1e-8, `Ball through sideline: ${context}`);
  if (Math.abs(ball.z) >= FIELD.goal - FIELD.radius || ball.y >= FIELD.height - FIELD.radius) {
    assert.ok(Math.abs(ball.x) <= FIELD.x - FIELD.radius + 1e-8, `Ball through end board: ${context}`);
  }
  for (const p of match.players) {
    assert.ok([p.x, p.z, p.vx, p.vz].every(Number.isFinite), `Nonfinite player: ${context}`);
    assert.ok(Math.abs(p.x) <= FIELD.x - FIELD.player + 1e-8 && Math.abs(p.z) <= FIELD.z - FIELD.player + 1e-8, `Player through board: ${context}`);
  }
}

void test('continuous human pressure cannot push a corner ball outside or eject it without a strike', () => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const approach of ['diagonal', 'end-wall', 'sideline'] as const) {
    const {match, controls} = humanCorner(sx, sz, 0, approach);
    if (approach === 'diagonal') {
      Object.assign(match.players[1], {x: sx * 5.8, z: sz * 2.8, yaw: Math.atan2(sx, sz)});
      Object.assign(controls[1], {x: sx, z: sz});
    }
    for (let tick = 0; tick < 6 * 60; tick++) { step(match, controls); assertInsideBoards(match, `${sx}/${sz}, ${approach}, tick ${tick}`); }
    assert.ok(Math.abs(match.ball.x) > FIELD.x - .4 && Math.abs(match.ball.z) > FIELD.z - .4, `Uncommanded corner escape: ${approach}`);
    assert.deepEqual(match.score, [0, 0]); assert.equal(match.events.some(e => e.type === 'kick'), false);
  }
});

void test('manual taps and charged shots clear every corner even while the other human keeps pressing', () => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const striker of [0, 1]) {
    for (const approach of ['diagonal', 'end-wall', 'sideline'] as const) for (const shot of ['tap', 'kick', 'charged']) {
      const {match, controls} = humanCorner(sx, sz, striker, approach);
      const context = `${sx}/${sz}, striker ${striker}, ${approach}, ${shot}`;
      let escaped = false;
      for (let tick = 0; tick < 4 * 60 && !escaped; tick++) {
        const input: [Input, Input] = [{...controls[0]}, {...controls[1]}];
        input[striker].charge = shot === 'charged' && tick >= 30 && tick < 90;
        input[striker].tap = shot === 'tap' && tick === 90;
        input[striker].shoot = shot !== 'tap' && tick === 90;
        const x = match.ball.x, z = match.ball.z;
        step(match, input); assertInsideBoards(match, `${context}, tick ${tick}`);
        assert.ok(Math.hypot(match.ball.x - x, match.ball.z - z) < .35, `Ball jumped instead of clearing: ${context}`);
        escaped = Math.abs(match.ball.x) < FIELD.x - 1.8 || Math.abs(match.ball.z) < FIELD.z - 1.8;
        if (escaped) assert.ok(tick > 90, `Corner escaped before the manual strike: ${context}`);
      }
      assert.equal(escaped, true, `Manual strike stayed pinned: ${context}`);
      assert.equal(match.events.filter(e => e.type === 'kick' && e.player === striker).length, 1, `Strike did not contact once: ${context}`);
      assert.deepEqual(match.score, [0, 0], `Corner clearance manufactured a goal: ${context}`);
    }
  }
});

void test('bank-shot clearance requires a real hit near a solid board and keeps opponent blocking', () => {
  const miss = playing(); step(miss, [{...idleInput(), tap:true}, idleInput()]); advance(miss, .2);
  assert.equal(miss.players[0].kickClearance, 0); assert.equal(miss.events.some(e => e.type === 'kick'), false);
  const match = playing(); Object.assign(match.players[0], {x:-.78, yaw:Math.PI / 2}); match.players[1].x = .9;
  step(match, [{...idleInput(), tap:true}, idleInput()]); advance(match, .18);
  assert.equal(match.players[0].kickClearance, 0, 'Open-field tap received bank-shot clearance'); assert.equal(match.players[1].kickClearance, 0);
  assert.ok(match.ball.vx < 0, 'Opponent failed to block the tap');
  const opening = playing(); Object.assign(opening.ball, {x:7.2}); Object.assign(opening.players[0], {x:6.1, yaw:Math.PI / 2});
  step(opening, [{...idleInput(), tap:true}, idleInput()]); advance(opening, .1);
  assert.equal(opening.events.some(e => e.type === 'kick'), true); assert.equal(opening.players[0].kickClearance, 0, 'Open goal mouth received bank-shot clearance');
  const bank = playing(); Object.assign(bank.ball, {x:0, z:4.41});
  Object.assign(bank.players[0], {x:0, z:3.23, yaw:0}); Object.assign(bank.players[1], {x:0, z:2.25});
  step(bank, [{...idleInput(), tap:true}, idleInput()]);
  let closestToOpponent = bank.ball.z;
  for (let tick = 0; tick < 75; tick++) {
    step(bank, [idleInput(), idleInput()]); closestToOpponent = Math.min(closestToOpponent, bank.ball.z);
    assert.equal(bank.players[1].kickClearance, 0);
  }
  assert.ok(closestToOpponent >= bank.players[1].z + FIELD.player + FIELD.radius - .01, 'Bank rebound passed through the opponent');
  assert.ok(bank.ball.vz > 0, 'Opponent did not reflect the inward bank rebound');
  match.players[0].kickClearance = .3; match.phase = 'goal'; match.phaseTime = .001;
  step(match, [idleInput(), idleInput()]); assert.equal(match.players[0].kickClearance, 0);
});

void test('stationary manual bank taps leave the striker without a depenetration jump when grace ends', () => {
  for (const side of [-1, 1]) {
    const match = playing(); Object.assign(match.ball, {x:0, z:side * 4.41});
    Object.assign(match.players[0], {x:0, z:side * 3.23, yaw:side > 0 ? 0 : Math.PI});
    step(match, [{...idleInput(), tap:true}, idleInput()]);
    let released = false;
    for (let tick = 0; tick < 90; tick++) {
      const x = match.ball.x, z = match.ball.z;
      step(match, [idleInput(), idleInput()]); assertInsideBoards(match, `stationary bank ${side}`);
      assert.ok(Math.hypot(match.ball.x - x, match.ball.z - z) < .09, 'Ending clearance teleported the ball');
      released ||= match.players[0].kickClearance > 0;
    }
    assert.equal(released, true); assert.equal(match.players[0].kickClearance, 0);
    assert.ok(match.ball.z * side < match.players[0].z * side - FIELD.player - FIELD.radius);
    assert.deepEqual(match.score, [0, 0]);
  }
});

void test('board correction preserves inward velocity and normal corner ricochets still lose energy', () => {
  for (const axis of ['x', 'z'] as const) for (const side of [-1, 1]) {
    const match = playing(); match.ball.z = 2.5;
    if (axis === 'x') { match.ball.x = side * 7.5; match.ball.vx = -side * 2; }
    else { match.ball.z = side * 4.5; match.ball.vz = -side * 2; }
    step(match, [idleInput(), idleInput()]); assertInsideBoards(match, `inward ${axis}/${side}`);
    assert.ok(match.ball[axis === 'x' ? 'vx' : 'vz'] * side < 0, 'Repair reflected an already inward velocity');
    assert.deepEqual(match.score, [0, 0]);
  }
  const match = playing(); Object.assign(match.ball, {x:7.4, z:4.4, vx:8, vz:6});
  step(match, [idleInput(), idleInput()]); assertInsideBoards(match, 'normal corner ricochet');
  assert.ok(match.ball.vx < 0 && match.ball.vz < 0); assert.ok(Math.hypot(match.ball.vx, match.ball.vz) < 10);
});

void test('manual charged strikes still cross both goal planes and score exactly once', () => {
  for (const side of [-1, 1]) {
    const id = side > 0 ? 0 : 1, match = playing(); match.ball.x = side * 6.9;
    Object.assign(match.players[id], {x:side * 6.1, yaw:side * Math.PI / 2});
    const controls: [Input, Input] = [idleInput(), idleInput()]; controls[id].charge = true;
    for (let tick = 0; tick < 60; tick++) step(match, controls);
    controls[id].charge = false; controls[id].shoot = true; step(match, controls);
    advance(match, .8); assert.equal(match.score[id], 1); assert.equal(match.lastScorer, id);
    advance(match, 1); assert.equal(match.score[id], 1); assert.equal(match.events.filter(e => e.type === 'goal').length, 1);
  }
});

