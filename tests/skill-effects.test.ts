import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step, idleInput, DT, type Input } from '../game/sim.ts';
import { flashPresentation } from '../game/skill-effects.ts';

void test('a confirmed Flash hides the ball only for its target in either seat, then restores sight without altering physics', () => {
  for (const caster of [0, 1]) {
    const state = createMatch('watti', undefined, 'watti'); state.phase = 'play';
    Object.assign(state.players[0], { x: -.7, yaw: Math.PI / 2 });
    Object.assign(state.players[1], { x: .7, yaw: -Math.PI / 2 });
    Object.assign(state.ball, { x: -3, z: 3, vx: 1 });
    const inputs: [Input, Input] = [idleInput(), idleInput()]; inputs[caster] = { ...idleInput(), seq: 1, skill: true };
    step(state, inputs);
    const target = 1 - caster, physicalBall = structuredClone(state.ball);
    assert.equal(flashPresentation(state, target).ballVisible, false);
    assert.equal(flashPresentation(state, caster).ballVisible, true);
    assert.deepEqual(state.ball, physicalBall, 'reading visibility must not mutate shared ball state');
    state.phase = 'paused'; step(state, [idleInput(), idleInput()]);
    assert.equal(flashPresentation(state, target).ballVisible, false, 'pause cannot bypass blindness');
    state.phase = 'play';
    for (let i = 0; i < 57; i++) step(state, [idleInput(), idleInput()], DT);
    const recovering = flashPresentation(state, target);
    assert.equal(recovering.ballVisible, true); assert.ok(recovering.strength > 0 && recovering.strength < 1);
    assert.notEqual(state.ball.x, physicalBall.x, 'the obscured ball keeps moving');
    for (let i = 0; i < 20; i++) step(state, [idleInput(), idleInput()], DT);
    assert.deepEqual(flashPresentation(state, target), { strength: 0, ballVisible: true });
  }
});
