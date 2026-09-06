import * as THREE from 'three';
import { clamp } from './sim';

/** Sagittal IK from the Microduck MJCF pivots, in native meters. */
export function duckLegPose(side: 'left' | 'right', dx: number, lift: number) {
  const upper = .042000010529, lower = .042;
  const alpha0 = -2.132375838608, bend0 = -1.117796326795 - alpha0;
  const x = .000015921846 + dx - .004, y = .026375681600 + lift - .099688924714;
  const bend = Math.acos(clamp((x * x + y * y - upper * upper - lower * lower) / (2 * upper * lower), -1, 1));
  const alpha = Math.atan2(y, x) - Math.atan2(lower * Math.sin(bend), upper + lower * Math.cos(bend));
  const sign = side === 'left' ? -1 : 1;
  const hip = (alpha - alpha0) / sign, knee = (bend - bend0) / -sign;
  return { hip, knee, ankle: knee - hip };
}

export function duckStep(distance: number, scale: number, offset: number) {
  const stride = .026, u = ((distance / (4 * stride * scale) + offset) % 1 + 1) % 1;
  if (u < .5) return { dx: stride * (1 - 4 * u), lift: 0 };
  const t = 2 * u - 1;
  // Match horizontal velocity at toe-off and landing; stance cancels root motion.
  return { dx: stride * (-1 - 2 * t + 12 * t * t - 8 * t * t * t), lift: .008 * Math.sin(Math.PI * t) ** 2 };
}

type StewartRig = { joints: Record<string, { axis: [number, number, number]; range?: [number, number] }> };
/** Keeps the official six 85 mm rods attached to a separately controlled head. */
export function createReachyRodSolver(model: THREE.Object3D, rig: StewartRig) {
  const node = (name: string) => {
    const value = model.getObjectByName(name);
    if (!value) throw new Error(`Missing Reachy joint: ${name}`);
    return value;
  };
  const head = node('body_xl_330'), body = node('joint_yaw_body');
  const targets = [[.00768882,-.0217774,.0368953],[.00307947,-.0167102,.049105],[-.0189403,.0208215,.050171],[-.0214133,.0278259,.0383042],[-.00708235,.0120716,.000342873],[0,0,0]];
  const ends = [[.085,0,0],[.043,-.0729378,-.00748861],[-.085,0,0],[-.085,0,0],[-.085,0,0],[-.085,0,0]];
  const branches = targets.map((target, i) => {
    const suffix = i ? `_${i + 1}` : '', joint = rig.joints[`stewart_${i + 1}`], end = new THREE.Vector3().fromArray(ends[i]);
    return { target: new THREE.Vector3().fromArray(target), end, direction: end.clone().normalize(), length: end.length(),
      base: node(`body_dc15_a01_horn_dummy${suffix}`), motor: node(`joint_stewart_${i + 1}`), axis: new THREE.Vector3().fromArray(joint.axis).normalize(),
      rod: node(`body_stewart_link_rod${suffix}`), passive: node(`joint_passive_${i + 1}`), limits: joint.range ?? [-Math.PI, Math.PI], angle: 0 };
  });
  const previousPosition = head.position.clone(), previousQuaternion = head.quaternion.clone(), previousBody = body.quaternion.clone();
  const normalize = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const restore = () => { head.position.copy(previousPosition); head.quaternion.copy(previousQuaternion); body.quaternion.copy(previousBody); model.updateWorldMatrix(true, true); return false; };
  return () => {
    model.updateWorldMatrix(true, true);
    const prepared = [];
    for (const branch of branches) {
      const target = head.localToWorld(branch.target.clone()), p = branch.base.worldToLocal(target.clone());
      const radius = .04, z = .007, rho = Math.hypot(p.x, p.y);
      if (rho < 1e-8) return restore();
      const c = (p.x * p.x + p.y * p.y + (p.z - z) ** 2 + radius * radius - branch.length ** 2) / (2 * radius * rho);
      if (Math.abs(c) > 1.000001) return restore();
      const phase = Math.atan2(p.y, p.x), alpha = Math.acos(clamp(c, -1, 1));
      const candidates = [normalize(phase + alpha), normalize(phase - alpha)]
        .filter(a => a >= branch.limits[0] - 1e-6 && a <= branch.limits[1] + 1e-6)
        .sort((a, b) => Math.abs(normalize(a - branch.angle)) - Math.abs(normalize(b - branch.angle)));
      if (!candidates.length) return restore();
      prepared.push({ branch, target, angle: candidates[0] });
    }
    for (const { branch, angle } of prepared) { branch.motor.quaternion.setFromAxisAngle(branch.axis, angle); branch.angle = angle; }
    model.updateWorldMatrix(true, true);
    for (const { branch, target } of prepared) branch.passive.quaternion.setFromUnitVectors(branch.direction, branch.rod.worldToLocal(target.clone()).normalize());
    model.updateWorldMatrix(true, true);
    previousPosition.copy(head.position); previousQuaternion.copy(head.quaternion); previousBody.copy(body.quaternion);
    return true;
  };
}
