export const ROBOT_KINDS = ['watti', 'microduck', 'reachy'] as const;
export type RobotKind = typeof ROBOT_KINDS[number];
export const ROBOT_NAMES = { watti: 'Watti', microduck: 'Microduck', reachy: 'Reachy Mini' } as const satisfies Record<RobotKind, string>;
export function isRobotKind(value: unknown): value is RobotKind {
  return typeof value === 'string' && ROBOT_KINDS.some(kind => kind === value);
}
export type SoloOpponent = RobotKind | 'random';
export function selectSoloOpponent(choice: SoloOpponent, playerKind?: RobotKind, rng: () => number = Math.random): RobotKind {
  if (choice !== 'random') return choice;
  const choices = playerKind ? ROBOT_KINDS.filter(kind => kind !== playerKind) : ROBOT_KINDS;
  const sample = rng();
  const index = Number.isFinite(sample) ? Math.max(0, Math.min(choices.length - 1, Math.floor(sample * choices.length))) : 0;
  return choices[index];
}
export type Phase = 'countdown' | 'play' | 'goal' | 'finished' | 'paused';
export type Input = { seq: number; x: number; z: number; sprint: boolean; charge: boolean; shoot: boolean; tap: boolean; skill?: boolean };
export const SKILL_COOLDOWN = 10;
export const REACHY_VAULT_DURATION = .65;
export const WATTI_FLASH_DURATION = .3;
// Match the stagger duration so the player can read the active Trip sector.
export const MICRODUCK_TRIP_DURATION = .55;
// A little more reach makes the close-range sweep reliable without widening its front cone.
export const MICRODUCK_TRIP_RANGE = 1.5;
export const SKILLS = {
  watti: { name: 'Flash', description: 'Dazzle an opponent ahead for 1.2 seconds. Short range.' },
  microduck: { name: 'Trip', description: 'Briefly slow a nearby opponent ahead and interrupt their shot.' },
  reachy: { name: 'Vault', description: 'Hop forward over an opponent. No ball contact while airborne.' },
} as const satisfies Record<RobotKind, { name: string; description: string }>;
export type Player = {
  id: number; kind: RobotKind; name: string; x: number; z: number; vx: number; vz: number;
  yaw: number; distance: number; charge: number; energy: number; cooldown: number;
  kickClearance: number; // Bank-shot self-contact grace; kept until overlap clears.
  skillCooldown: number; skillTime: number; blinded: number; staggered: number;
  skillHeld: boolean; skillSeq: number;
  action: 'none' | 'kick' | 'tap'; actionTime: number; actionPower: number; contacted: boolean; ack: number;
};
export type Ball = { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number };
export type GameEvent = { id: number; type: 'kick' | 'goal' | 'start' | 'finish' | 'bounce' | 'skill'; player: number; x: number; z: number };
export type MatchState = {
  tick: number; phase: Phase; phaseTime: number; time: number; overtime: boolean;
  score: [number, number]; players: [Player, Player]; ball: Ball; events: GameEvent[]; eventId: number;
  winner: number | null; lastScorer: number | null;
};
export const FIELD = { x: 7.6, z: 4.6, goal: 1.5, height: 1.7, radius: .18, player: .46 } as const;
export const DT = 1 / 60;
export const idleInput = (): Input => ({ seq: 0, x: 0, z: 0, sprint: false, charge: false, shoot: false, tap: false, skill: false });
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const isVaulting = (p: Player) => p.kind === 'reachy' && p.skillTime > 0;
export function playerMovementSpeed(p: Player, input: Input) {
  if (isVaulting(p)) return 3.4;
  const sprint = input.sprint && p.energy > .03 && Math.hypot(input.x, input.z) > .1;
  return (sprint ? 4.8 : 3.25) * (input.charge && p.staggered === 0 && p.skillTime === 0 ? .72 : 1) * (p.staggered > 0 ? .35 : 1);
}
export function createMatch(kind: RobotKind = 'watti', names?: string[], opponentKind: RobotKind = kind === 'watti' ? 'microduck' : 'watti'): MatchState {
  const player = (id: number, k: RobotKind): Player => ({ id, kind: k, name: names?.[id] ?? ROBOT_NAMES[k], x: id ? 4.2 : -4.2, z: 0, vx: 0, vz: 0, yaw: id ? -Math.PI / 2 : Math.PI / 2, distance: 0, charge: 0, energy: 1, cooldown: 0, kickClearance: 0, skillCooldown: 0, skillTime: 0, blinded: 0, staggered: 0, skillHeld: false, skillSeq: -1, action: 'none', actionTime: 0, actionPower: 0, contacted: false, ack: 0 });
  return { tick: 0, phase: 'countdown', phaseTime: 3, time: 180, overtime: false, score: [0, 0], players: [player(0, kind), player(1, opponentKind)], ball: { x: 0, y: FIELD.radius, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 }, events: [], eventId: 0, winner: null, lastScorer: null };
}
function event(s: MatchState, type: GameEvent['type'], player = -1) {
  const source = type === 'skill' ? s.players[player] : s.ball;
  s.events.push({ id: ++s.eventId, type, player, x: source.x, z: source.z });
  if (s.events.length > 24) s.events.shift();
}
function restartPositions(s: MatchState) {
  s.ball = { x: 0, y: FIELD.radius, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 };
  s.players.forEach((p, i) => Object.assign(p, { x: i ? 4.2 : -4.2, z: 0, vx: 0, vz: 0, yaw: i ? -Math.PI / 2 : Math.PI / 2, charge: 0, energy: 1, cooldown: 0, kickClearance: 0, skillTime: 0, blinded: 0, staggered: 0, action: 'none', actionTime: 0 }));
}
export function finish(s: MatchState, winner: number | null) {
  s.phase = 'finished'; s.winner = winner; event(s, 'finish', winner ?? -1);
}
function goal(s: MatchState, scorer: number) {
  s.score[scorer]++; s.lastScorer = scorer;
  // Kickoff clears temporary effects; scoring never refreshes a used skill.
  s.players.forEach(p => { p.skillTime = 0; p.blinded = 0; p.staggered = 0; });
  event(s, 'goal', scorer);
  if (s.score[scorer] >= 5 || s.overtime) { finish(s, scorer); return; }
  s.phase = 'goal'; s.phaseTime = 2.6;
}
function inSkillCone(p: Player, target: Player, range: number) {
  const dx = target.x - p.x, dz = target.z - p.z, distance = Math.hypot(dx, dz);
  return distance <= range && (Math.sin(p.yaw) * dx + Math.cos(p.yaw) * dz) / Math.max(distance, .001) >= .5;
}
function skillsStep(s: MatchState, inputs: [Input, Input], dt: number) {
  // Decide both requests before applying effects, so seat order grants no priority.
  const activate = s.players.map((p, id) => {
    p.skillCooldown = Math.max(0, p.skillCooldown - dt);
    p.skillTime = Math.max(0, p.skillTime - dt);
    p.blinded = Math.max(0, p.blinded - dt);
    p.staggered = Math.max(0, p.staggered - dt);
    const input = inputs[id], pressed = input.skill === true;
    const edge = pressed && !p.skillHeld && input.seq > p.skillSeq;
    p.skillHeld = pressed;
    if (pressed) p.skillSeq = Math.max(p.skillSeq, input.seq);
    return edge && p.skillCooldown === 0 && p.skillTime === 0 && p.staggered === 0;
  });
  s.players.forEach((p, id) => {
    if (!activate[id]) return;
    p.skillCooldown = SKILL_COOLDOWN;
    p.skillTime = p.kind === 'reachy' ? REACHY_VAULT_DURATION : p.kind === 'watti' ? WATTI_FLASH_DURATION : MICRODUCK_TRIP_DURATION;
    p.action = 'none'; p.actionTime = 0; p.charge = 0;
    event(s, 'skill', id);
  });
  s.players.forEach((p, id) => {
    if (!activate[id] || p.kind === 'reachy') return;
    const target = s.players[1 - id];
    if (isVaulting(target) || !inSkillCone(p, target, p.kind === 'watti' ? 2.6 : MICRODUCK_TRIP_RANGE)) return;
    if (p.kind === 'watti') target.blinded = 1.2;
    else { target.staggered = .55; target.vx *= .35; target.vz *= .35; target.action = 'none'; target.actionTime = 0; target.charge = 0; }
  });
}
export function step(s: MatchState, inputs: [Input, Input], dt = DT) {
  if (s.phase === 'finished' || s.phase === 'paused') return;
  s.tick++;
  if (s.phase !== 'play') {
    // Consume attempts during stoppages so they cannot fire on the next kickoff.
    s.players.forEach((p, id) => { p.skillHeld = inputs[id].skill === true; if (p.skillHeld) p.skillSeq = Math.max(p.skillSeq, inputs[id].seq); });
    s.phaseTime -= dt;
    if (s.phaseTime <= 0) {
      if (s.phase === 'goal') { restartPositions(s); s.phase = 'countdown'; s.phaseTime = 2; }
      else { s.phase = 'play'; event(s, 'start'); }
    }
    return;
  }
  dt = Math.min(dt, s.time);
  s.time = Math.max(0, s.time - dt);
  skillsStep(s, inputs, dt);
  s.players.forEach((p, id) => {
    const input = inputs[id]; p.ack = input.seq;
    const ix = Number.isFinite(input.x) ? clamp(input.x, -1, 1) : 0, iz = Number.isFinite(input.z) ? clamp(input.z, -1, 1) : 0;
    const len = Math.hypot(ix, iz);
    const mx = ix / Math.max(1, len), mz = iz / Math.max(1, len);
    const vaulting = isVaulting(p);
    const sprint = !vaulting && input.sprint && p.energy > .03 && len > .1;
    const speed = playerMovementSpeed(p, { ...input, x: ix, z: iz });
    p.energy = clamp(p.energy + (sprint ? -.31 : .23) * dt, 0, 1);
    const accel = 1 - Math.exp(-11 * dt);
    if (vaulting) { p.vx = Math.sin(p.yaw) * speed; p.vz = Math.cos(p.yaw) * speed; }
    else { p.vx += (mx * speed - p.vx) * accel; p.vz += (mz * speed - p.vz) * accel; }
    if (!vaulting && len > .12) {
      const target = Math.atan2(mx, mz);
      const angle = Math.atan2(Math.sin(target - p.yaw), Math.cos(target - p.yaw));
      p.yaw += clamp(angle, -9 * dt, 9 * dt);
    }
    p.x = clamp(p.x + p.vx * dt, -FIELD.x + FIELD.player, FIELD.x - FIELD.player);
    p.z = clamp(p.z + p.vz * dt, -FIELD.z + FIELD.player, FIELD.z - FIELD.player);
    p.distance += Math.hypot(p.vx, p.vz) * dt;
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (p.kickClearance > 0) {
      p.kickClearance = Math.max(0, p.kickClearance - dt);
      // Restoring a collider while the rebound still overlaps it would teleport
      // the ball during depenetration. Finish the release when they separate.
      if (p.kickClearance === 0 && Math.hypot(s.ball.x - p.x, s.ball.z - p.z) < FIELD.player + FIELD.radius + .02) p.kickClearance = DT;
    }
    const canStrike = p.staggered === 0 && p.skillTime === 0;
    if (input.charge && p.cooldown === 0 && canStrike) p.charge = Math.min(1, p.charge + dt / .8);
    if ((input.shoot || input.tap) && p.cooldown === 0 && canStrike) {
      p.action = input.tap ? 'tap' : 'kick'; p.actionTime = 0; p.actionPower = Math.max(.12, p.charge);
      p.contacted = false; p.charge = 0; p.cooldown = input.tap ? .4 : .7;
    }
    if (!input.charge || !canStrike) p.charge = 0;
    if (p.action !== 'none') {
      p.actionTime += dt;
      if (!p.contacted && p.actionTime >= (p.action === 'tap' ? .09 : .19)) {
        p.contacted = true;
        const b = s.ball, dx = b.x - p.x, dz = b.z - p.z;
        const d = Math.hypot(dx, dz), dot = (Math.sin(p.yaw) * dx + Math.cos(p.yaw) * dz) / Math.max(d, .01);
        if (d < 1.2 && dot > .12 && b.y < 1.15) {
          const power = p.action === 'tap' ? 4.4 : 7.3 + p.actionPower * 7;
          b.vx = Math.sin(p.yaw) * power + p.vx * .18;
          b.vz = Math.cos(p.yaw) * power + p.vz * .18;
          b.vy = p.action === 'tap' ? .65 : 1.8 + p.actionPower * 2.7;
          const opening = Math.abs(b.z) < FIELD.goal - FIELD.radius && b.y < FIELD.height - FIELD.radius;
          const bankShot = (Math.abs(b.z) > FIELD.z - FIELD.radius - .36 && b.vz * b.z > 0)
            || (!opening && Math.abs(b.x) > FIELD.x - FIELD.radius - .36 && b.vx * b.x > 0);
          // Only an outward shot beside a solid board needs a release window.
          // Open-field strikes and the opponent's collider remain unchanged.
          p.kickClearance = bankShot ? .35 : 0;
          event(s, 'kick', id);
        }
      }
      if (p.actionTime > .65) p.action = 'none';
    }
  });
  const a = s.players[0], b = s.players[1];
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
  if (!isVaulting(a) && !isVaulting(b) && d < FIELD.player * 2) {
    const overlap = (FIELD.player * 2 - d) / 2, nx = d > .001 ? dx / d : 1, nz = d > .001 ? dz / d : 0;
    a.x -= nx * overlap; a.z -= nz * overlap; b.x += nx * overlap; b.z += nz * overlap;
    for (const p of s.players) { p.x = clamp(p.x, -FIELD.x + FIELD.player, FIELD.x - FIELD.player); p.z = clamp(p.z, -FIELD.z + FIELD.player, FIELD.z - FIELD.player); }
    // If a wall absorbed half the separation, the other body takes the rest.
    // This also ensures a vault landing cannot remain embedded beside a board.
    const gap = Math.hypot(b.x - a.x, b.z - a.z), remaining = FIELD.player * 2 - gap;
    if (remaining > .00001) {
      const freeX = gap > .001 ? (b.x - a.x) / gap : nx, freeZ = gap > .001 ? (b.z - a.z) / gap : nz;
      const oldX = a.x, oldZ = a.z;
      a.x = clamp(a.x - freeX * remaining, -FIELD.x + FIELD.player, FIELD.x - FIELD.player);
      a.z = clamp(a.z - freeZ * remaining, -FIELD.z + FIELD.player, FIELD.z - FIELD.player);
      const rest = Math.max(0, remaining - Math.hypot(a.x - oldX, a.z - oldZ));
      b.x = clamp(b.x + freeX * rest, -FIELD.x + FIELD.player, FIELD.x - FIELD.player);
      b.z = clamp(b.z + freeZ * rest, -FIELD.z + FIELD.player, FIELD.z - FIELD.player);
    }
  }
  // Substeps bound travel to less than half a ball radius; no goal or wall tunnelling.
  const count = Math.max(1, Math.ceil(Math.hypot(s.ball.vx, s.ball.vz, s.ball.vy) * dt / (FIELD.radius * .45)));
  for (let i = 0; i < count && s.phase === 'play'; i++) ballStep(s, dt / count);
  if (s.time === 0 && (s.phase as Phase) !== 'finished') {
    if (s.score[0] !== s.score[1]) finish(s, s.score[0] > s.score[1] ? 0 : 1);
    else if (s.overtime) finish(s, null);
    else { s.overtime = true; s.time = 60; }
  }
}
function constrainBallToBoards(b: Ball) {
  const r = FIELD.radius;
  if (Math.abs(b.z) > FIELD.z - r) {
    const side = Math.sign(b.z); b.z = side * (FIELD.z - r);
    if (b.vz * side > 0) b.vz *= -.72;
  }
  const opening = Math.abs(b.z) < FIELD.goal - r && b.y < FIELD.height - r;
  if (!opening && Math.abs(b.x) > FIELD.x - r) {
    const side = Math.sign(b.x); b.x = side * (FIELD.x - r);
    if (b.vx * side > 0) b.vx *= -.75;
  }
}
function ballStep(s: MatchState, dt: number) {
  const b = s.ball, r = FIELD.radius;
  const oldX = b.x, oldY = b.y, oldZ = b.z;
  b.vy -= 12 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  // Test the exact full-ball crossing before a diagonal shot can leave the aperture.
  for (const side of [-1, 1]) {
    const plane = side * (FIELD.x + r);
    if (side * oldX <= side * plane && side * b.x > side * plane) {
      const t = (plane - oldX) / (b.x - oldX), z = oldZ + (b.z - oldZ) * t, y = oldY + (b.y - oldY) * t;
      if (Math.abs(z) < FIELD.goal - r && y < FIELD.height - r) { goal(s, side > 0 ? 0 : 1); return; }
    }
  }
  if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy) > .7 ? -b.vy * .52 : 0; }
  const drag = Math.exp(-(b.y <= r + .005 ? .55 : .12) * dt);
  b.vx *= drag; b.vz *= drag; b.spin += Math.hypot(b.vx, b.vz) * dt / r;
  constrainBallToBoards(b);
  const opening = Math.abs(b.z) < FIELD.goal - r && b.y < FIELD.height - r;
  if (opening && Math.abs(b.x) > FIELD.x + r) { goal(s, b.x > 0 ? 0 : 1); return; }
  for (const p of s.players) {
    if (b.y > 1 || p.kickClearance > 0 || isVaulting(p)) continue;
    const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz), min = r + FIELD.player;
    if (d < min) {
      const nx = d > .001 ? dx / d : Math.sin(p.yaw), nz = d > .001 ? dz / d : Math.cos(p.yaw);
      b.x = p.x + nx * min; b.z = p.z + nz * min;
      const projectedX = b.x, projectedZ = b.z;
      constrainBallToBoards(b);
      const blocked = b.x !== projectedX || b.z !== projectedZ;
      if (blocked) {
        // The ball cannot separate through a board; resolve the remaining
        // overlap on the player instead of leaving the ball outside the pitch.
        const gapX = b.x - p.x, gapZ = b.z - p.z, gap = Math.hypot(gapX, gapZ);
        const rx = gap > .001 ? gapX / gap : nx, rz = gap > .001 ? gapZ / gap : nz;
        const overlap = Math.max(0, min - gap);
        p.x = clamp(p.x - rx * overlap, -FIELD.x + FIELD.player, FIELD.x - FIELD.player);
        p.z = clamp(p.z - rz * overlap, -FIELD.z + FIELD.player, FIELD.z - FIELD.player);
        const approach = p.vx * rx + p.vz * rz;
        if (approach > 0) { p.vx -= approach * rx; p.vz -= approach * rz; }
      }
      const rel = (b.vx - p.vx) * nx + (b.vz - p.vz) * nz;
      if (rel < 0) {
        // At a board, both bodies take the contact impulse so a second robot
        // cannot act as an immovable wedge. Open-field contacts are unchanged.
        const impulse = -rel * 1.38, playerShare = blocked ? .5 : 0;
        b.vx += impulse * (1 - playerShare) * nx; b.vz += impulse * (1 - playerShare) * nz;
        p.vx -= impulse * playerShare * nx; p.vz -= impulse * playerShare * nz;
      }
    }
  }
  for (const x of [-FIELD.x, FIELD.x]) for (const z of [-FIELD.goal, FIELD.goal]) {
    if (b.y > FIELD.height) continue;
    const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
    if (d < r + .07) {
      const nx = dx / Math.max(d, .001), nz = dz / Math.max(d, .001), v = b.vx * nx + b.vz * nz;
      b.x = x + nx * (r + .071); b.z = z + nz * (r + .071);
      if (v < 0) { b.vx -= v * 1.8 * nx; b.vz -= v * 1.8 * nz; }
    }
  }
  // Body and goalpost corrections must respect the same board constraints.
  constrainBallToBoards(b);
}
export function aiInput(s: MatchState, id: number): Input {
  const p = s.players[id], b = s.ball, attack = id ? -1 : 1;
  // A flashed bot loses sight just as a human does; it cannot track the hidden ball.
  if (p.blinded > 0) return { ...idleInput(), seq: s.tick };
  // AI taps clear corners. Step out of the rebound path after contact instead
  // of trapping the returning ball between the robot and the boards again.
  if (p.action === 'tap' && p.contacted && p.actionTime < .6) return { ...idleInput(), seq: s.tick, x: -Math.sign(b.x) };
  const t = Math.min(.5, Math.hypot(p.x - b.x, p.z - b.z) / 8);
  const bx = clamp(b.x + b.vx * t, -7.25, 7.25), bz = clamp(b.z + b.vz * t, -4.42, 4.42);
  const goalX = attack * 8 - bx, goalZ = -bz * .8, goalLength = Math.hypot(goalX, goalZ);
  // Behind a corner ball lies outside the pitch. Bank it off both boards from
  // the reachable inside diagonal, then return to aiming at the opponent's goal.
  const corner = Math.abs(b.x) > FIELD.x - 1.1 && Math.abs(b.z) > FIELD.z - 1.1;
  const gx = corner ? Math.sign(b.x) * Math.SQRT1_2 : goalX / goalLength;
  const gz = corner ? Math.sign(b.z) * Math.SQRT1_2 : goalZ / goalLength;
  let tx = clamp(bx - gx * .82, -7.1, 7.1), tz = clamp(bz - gz * .82, -4.07, 4.07);
  if (!corner && (p.x - bx) * attack > .25) { tx = clamp(bx - attack * 1.05, -7.1, 7.1); tz = clamp(bz + (p.z > bz ? 1 : -1) * .95, -4.07, 4.07); }
  const d = Math.hypot(b.x - p.x, b.z - p.z);
  const behind = (b.x - p.x) * gx + (b.z - p.z) * gz > .24;
  if (d < 1.08 && behind) { tx = p.x + gx * 2; tz = p.z + gz * 2; }
  const dx = tx - p.x, dz = tz - p.z, len = Math.hypot(dx, dz);
  const canKick = d < 1.1 && behind && b.y < .9 && p.cooldown === 0;
  // Keep enough steering input to turn, without rushing beyond tap range.
  const amount = corner && d < 1.15 ? .15 : 1;
  const facing = Math.sin(p.yaw) * gx + Math.cos(p.yaw) * gz;
  const opponent = s.players[1 - id], ready = p.skillCooldown === 0 && p.skillTime === 0 && p.staggered === 0;
  const opponentNearBall = Math.hypot(opponent.x - b.x, opponent.z - b.z) < 1.6;
  const skill = ready && !isVaulting(opponent) && (p.kind === 'reachy'
    ? !corner && d > 1.5 && inSkillCone(p, opponent, 1.8) && facing > .6
    : opponentNearBall && inSkillCone(p, opponent, p.kind === 'watti' ? 2.3 : 1.2));
  return { seq: s.tick, x: len > .09 ? dx / Math.max(len, .3) * amount : 0, z: len > .09 ? dz / Math.max(len, .3) * amount : 0, sprint: d > 2.5 && p.energy > .3, charge: false, shoot: !corner && canKick && !skill, tap: corner && canKick && facing > .9 && !skill, skill };
}

