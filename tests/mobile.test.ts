import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { TouchInput, stickVector } from '../game/touch-input.ts';
import { mobileCamera } from '../game/mobile-camera.ts';
import { createMatch, step, idleInput, FIELD } from '../game/sim.ts';

void test('three fingers can move, sprint and shoot independently', () => {
  const input = new TouchInput();
  assert.equal(input.beginMove(10), true);
  assert.equal(input.beginMove(11), false);
  input.move(10, .8, -.6);
  assert.equal(input.beginAction(10, 'charge'), false);
  input.beginAction(11, 'charge'); input.beginAction(12, 'sprint');
  input.move(11, -1, 1);
  assert.deepEqual(input.read(), { x: .8, z: -.6, charge: true, sprint: true, shoot: false, tap: false, skill: false });
  input.release(11);
  assert.equal(input.read().shoot, true);
  assert.equal(input.read().sprint, true);
  assert.equal(input.read().x, .8);
  input.consumeEdges(); input.release(11, true);
  assert.equal(input.read().shoot, false, 'lost capture after pointerup must not shoot twice');
  input.release(10);
  assert.equal(input.read().x, 0);
  assert.equal(input.read().sprint, true);
  input.release(12); assert.equal(input.read().sprint, false);
});

void test('cancel, pause and late pointerup cannot fire a held shot', () => {
  const input = new TouchInput();
  input.beginAction(1, 'charge'); input.release(1, true);
  assert.equal(input.read().shoot, false);
  input.beginMove(1); input.move(1, 1, 1);
  input.beginAction(2, 'charge'); input.beginAction(3, 'tap'); input.beginAction(4, 'sprint');
  input.clear(); [1,2,3,4].forEach(id => input.release(id));
  const { seq: _seq, ...idle } = idleInput();
  assert.deepEqual(input.read(), { ...idle, skill: false });
});

void test('touch skills fire once per press and preserve movement and held controls', () => {
  const input = new TouchInput();
  input.beginMove(1); input.move(1, .5, -.5); input.beginAction(2, 'sprint');
  assert.equal(input.beginAction(1, 'skill'), false, 'the joystick finger cannot also own a skill');
  input.beginAction(3, 'skill'); assert.equal(input.read().skill, true);
  input.consumeEdges(); input.beginAction(4, 'skill');
  assert.equal(input.read().skill, false, 'a second finger cannot retrigger an already held skill');
  input.release(3); input.release(4); input.release(4, true);
  assert.equal(input.read().skill, false, 'release and lost capture are not new activations');
  assert.equal(input.read().sprint, true); assert.equal(input.read().x, .5);
  input.beginAction(3, 'skill'); input.release(3, true);
  assert.equal(input.read().skill, false, 'cancellation drops an unconsumed activation');
  input.pulse('skill'); assert.equal(input.read().skill, true, 'assistive activation can use the skill');
  input.consumeEdges(); assert.equal(input.read().skill, false);
  input.beginAction(3, 'skill'); input.consumeEdges(); input.cancelAction('skill');
  assert.equal(input.held('skill'), false, 'a newly disabled skill button releases its pointer ownership');
  assert.equal(input.read().sprint, true, 'disabling a skill leaves the other finger held');
  assert.equal(input.read().x, .5);
  assert.equal(input.beginAction(3, 'skill'), true, 'the pointer can activate again after cooldown');
  input.beginAction(3, 'skill'); input.clear(); input.release(3);
  assert.equal(input.read().skill, false, 'navigation clears pending skill input');
});

void test('two fingers on shoot release only when the last finger lifts', () => {
  const input = new TouchInput();
  input.beginAction(1, 'charge'); input.beginAction(2, 'charge');
  input.release(1); assert.equal(input.read().charge, true); assert.equal(input.read().shoot, false);
  input.release(2); assert.equal(input.read().charge, false); assert.equal(input.read().shoot, true);
  input.consumeEdges(); assert.equal(input.read().shoot, false);
});

void test('joystick stays neutral in its dead zone and clamps drags beyond its rim', () => {
  const center = stickVector(2, -2, 40); assert.equal(Math.hypot(center.x, center.z), 0);
  const diagonal = stickVector(500, -500, 40);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-10);
  assert.ok(Math.abs(Math.hypot(diagonal.knobX, diagonal.knobY) - 40) < 1e-10);
  assert.ok(diagonal.x > 0 && diagonal.z < 0);
});

void test('a touch charge and release produces exactly one simulation kick', () => {
  const state = createMatch(); state.phase = 'play';
  state.players[0].x = -.78; state.players[0].yaw = Math.PI / 2;
  const input = new TouchInput(); input.beginAction(1, 'charge');
  const tick = () => { step(state, [{ ...input.read(), seq: state.tick }, idleInput()]); input.consumeEdges(); };
  for (let i = 0; i < 45; i++) tick();
  assert.ok(state.players[0].charge > .5);
  input.release(1);
  for (let i = 0; i < 45; i++) tick();
  assert.equal(state.events.filter(event => event.type === 'kick').length, 1);
  assert.ok(state.ball.x > .5, 'touch kick must move the actual ball');
});

const viewports = [[568, 320], [667, 375], [844, 390], [932, 430], [1024, 768]] as const;

function phoneProjection(width: number, height: number, overhead: boolean) {
  const frame = mobileCamera(width, height, overhead);
  const camera = new PerspectiveCamera(43, width / height, .1, 100);
  camera.position.set(frame.position.x, frame.position.y, frame.position.z);
  camera.lookAt(frame.target.x, frame.target.y, frame.target.z);
  camera.setViewOffset(width, height, 0, frame.offsetY, width, height);
  camera.updateMatrixWorld();
  const project = (point: Vector3) => {
    const p = point.clone().project(camera);
    return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2, z: p.z };
  };
  return { camera, project };
}

void test('both phone cameras fit the complete pitch and goals below the scoreboard', () => {
  const points = [
    ...[-FIELD.x - .18, FIELD.x + .18].flatMap(x =>
      [-FIELD.z - .18, FIELD.z + .18].flatMap(z => [0, .65].map(y => new Vector3(x, y, z)))),
    ...[-8.72, 8.72].flatMap(x =>
      [-FIELD.goal - .08, FIELD.goal + .08].flatMap(z => [0, FIELD.height + .08].map(y => new Vector3(x, y, z)))),
  ];
  for (const [width, height] of viewports) {
    for (const overhead of [false, true]) {
      const { project } = phoneProjection(width, height, overhead);
      for (const point of points) {
        const p = project(point);
        assert.ok(p.x >= 8 && p.x <= width - 8, `${width}×${height}: cropped pitch/goal x=${p.x}`);
        assert.ok(p.y >= 52 && p.y <= height - 8, `${width}×${height}: pitch/goal outside play region y=${p.y}`);
        assert.ok(p.z > -1 && p.z < 1, 'within camera clipping planes');
      }
    }
  }
});

void test('phone gameplay uses substantial screen height for the playable pitch', () => {
  const corners = [-FIELD.x, FIELD.x].flatMap(x =>
    [-FIELD.z, FIELD.z].map(z => new Vector3(x, .024, z)));
  for (const [width, height] of viewports) {
    for (const overhead of [false, true]) {
      const { project } = phoneProjection(width, height, overhead);
      const ys = corners.map(point => project(point).y);
      const occupiedHeight = (Math.max(...ys) - Math.min(...ys)) / height;
      const minimum = width / height >= 1.7 ? (overhead ? .68 : .55) : (overhead ? .53 : .44);
      assert.ok(occupiedHeight >= minimum,
        `${width}×${height}, overhead=${overhead}: pitch occupies only ${(occupiedHeight * 100).toFixed(1)}% of height`);
    }
  }
});

void test('the ball stays large enough to track in both phone views', () => {
  for (const [width, height] of viewports) {
    for (const overhead of [false, true]) {
      const { camera, project } = phoneProjection(width, height, overhead);
      const screenUp = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      const center = new Vector3(0, FIELD.radius, 0);
      const top = project(center.clone().addScaledVector(screenUp, FIELD.radius));
      const bottom = project(center.clone().addScaledVector(screenUp, -FIELD.radius));
      const diameter = Math.abs(bottom.y - top.y);
      const minimum = height * (width / height >= 1.7 ? .027 : .0225);
      assert.ok(diameter >= minimum,
        `${width}×${height}, overhead=${overhead}: projected ball is only ${diameter.toFixed(1)}px`);
    }
  }
});
