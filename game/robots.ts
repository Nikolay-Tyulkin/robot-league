import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, type MatchState, type Player, type RobotKind } from './sim';
import { createReachyRodSolver, duckLegPose, duckStep } from './kinematics';

type Joint = { node: string; axis: [number, number, number]; range?: [number, number]; restAngle: number; restQuaternion: [number, number, number, number] };
type Rig = { id: string; bounds: { size: number[] }; joints: Record<string, Joint> };
type CableAnchor = { node: THREE.Object3D; point: THREE.Vector3 };
type CableStrand = { start: CableAnchor; end: CableAnchor; back: THREE.Vector3; slack: number; radius: number };
export type RobotRole = 'player' | 'referee';

/** The forward head stroke peaks at the same instant as the simulation's contact. */
export function reachyActionPose(p: Pick<Player, 'action' | 'actionTime' | 'actionPower' | 'charge'>) {
  if (p.action === 'none') return { windup: clamp(p.charge, 0, 1), strike: 0 };
  const tap = p.action === 'tap', contact = tap ? .09 : .19, prepare = contact * .38;
  const t = Math.max(0, p.actionTime), recovery = tap ? .24 : .46;
  const forward = THREE.MathUtils.smoothstep(t, prepare, contact);
  const power = tap ? .44 : .62 + clamp(p.actionPower, 0, 1) * .38;
  const windup = tap ? .18 * THREE.MathUtils.smoothstep(t, 0, prepare) : Math.max(.15, clamp(p.actionPower, 0, 1));
  return { windup: windup * (1 - forward), strike: power * forward * (1 - THREE.MathUtils.smoothstep(t, contact, recovery)) };
}

export class Robot {
  root = new THREE.Group();
  model!: THREE.Group;
  rig!: Rig;
  joints = new Map<string, { object: THREE.Object3D; joint: Joint; rest: THREE.Quaternion; axis: THREE.Vector3 }>();
  ring!: THREE.Mesh;
  glow?: THREE.PointLight;
  private head?: THREE.Object3D;
  private headRest?: { pos: THREE.Vector3; quat: THREE.Quaternion; pivot: THREE.Vector3 };
  private solveRods?: () => boolean;
  private support = new Float32Array();
  private modelRest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
  private poseRotation = new THREE.Quaternion();
  private poseEuler = new THREE.Euler();
  private renderedRole?: RobotRole;
  private lastTick?: number;
  private cables?: { root: THREE.Object3D; mesh: THREE.Mesh; strands: CableStrand[] };
  private resources: (THREE.Material | THREE.BufferGeometry)[] = [];
  constructor(public kind: RobotKind | 'reachy', public role: RobotRole = 'player') {}
  async load(texture: THREE.Texture) {
    const [gltf, rig] = await Promise.all([
      new GLTFLoader().loadAsync(`/models/${this.kind}/model.glb?v=assembled-2`),
      fetch(`/models/${this.kind}/rig.json?v=assembled-2`).then(r => { if (!r.ok) throw new Error(`Failed to load model ${this.kind}`); return r.json() as Promise<Rig>; }),
    ]);
    this.model = gltf.scene; this.rig = rig;
    const scale = (this.role === 'referee' ? 1.6 : 1.75) / rig.bounds.size[1];
    this.model.scale.setScalar(scale); this.root.add(this.model);
    // Source robot forward is +X; root's gameplay heading is +Z.
    this.model.rotation.y = -Math.PI / 2;
    const meshes: THREE.Mesh[] = []; this.model.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
    this.model.updateWorldMatrix(true, true);
    const wattiMaterials = this.kind === 'watti' ? this.createWattiMaterials() : undefined;
    for (const mesh of meshes) {
      if (wattiMaterials) this.styleWattiMesh(mesh, wattiMaterials);
      else {
      const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      const material = new THREE.MeshStandardMaterial({ color: source.color ?? 0xc0c7c2, metalness: .12, roughness: .82, side: THREE.DoubleSide });
      material.color.multiplyScalar(1.2);
      material.onBeforeCompile = shader => {
        shader.uniforms.inkTexture = { value: texture };
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 inkP; varying vec3 inkN;');
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ninkP=position; inkN=normal;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D inkTexture; varying vec3 inkP; varying vec3 inkN;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          vec3 iw = pow(abs(normalize(inkN)), vec3(4.0)); iw /= max(dot(iw,vec3(1.0)),.001);
          float pigment = texture2D(inkTexture, inkP.yz*16.0).r*iw.x + texture2D(inkTexture, inkP.xz*16.0).r*iw.y + texture2D(inkTexture, inkP.xy*16.0).r*iw.z;
          diffuseColor.rgb *= .74 + .55*pigment;`);
      };
      material.customProgramCacheKey = () => 'robot-ink-v1';
      mesh.material = material; this.resources.push(material);
      }
      mesh.castShadow = true; mesh.receiveShadow = true;
      const outlineMat = new THREE.MeshBasicMaterial({ color: wattiMaterials ? 0x1c1916 : 0x11191b, side: THREE.BackSide });
      const outlineWidth = wattiMaterials ? '0.00035' : '0.0012';
      outlineMat.onBeforeCompile = shader => { shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normal * ${outlineWidth};`); };
      outlineMat.customProgramCacheKey = () => `robot-outline-${outlineWidth}`;
      const outline = new THREE.Mesh(mesh.geometry, outlineMat); outline.name = 'ink-outline'; mesh.add(outline); this.resources.push(outlineMat);
    }
    for (const [name, joint] of Object.entries(rig.joints)) {
      const object = this.model.getObjectByName(joint.node);
      if (object) this.joints.set(name, { object, joint, rest: new THREE.Quaternion().fromArray(joint.restQuaternion), axis: new THREE.Vector3().fromArray(joint.axis).normalize() });
    }
    const rg = new THREE.RingGeometry(.54, .58, 40), rm = new THREE.MeshBasicMaterial({ color: 0x59d2d7, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(rg, rm); this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = .035; this.root.add(this.ring); this.resources.push(rg, rm);
    if (this.kind === 'watti') { this.setupWattiLight(); this.setupWattiCables(); }
    if (this.kind === 'reachy') { this.setupHead(); this.setupSupport(); }
    this.resetPose();
  }
  setJoint(name: string, delta: number) {
    const j = this.joints.get(name); if (!j) return;
    const angle = clamp(j.joint.restAngle + delta, j.joint.range?.[0] ?? -Math.PI, j.joint.range?.[1] ?? Math.PI);
    j.object.quaternion.copy(j.rest).multiply(new THREE.Quaternion().setFromAxisAngle(j.axis, angle - j.joint.restAngle));
  }
  private createWattiMaterials() {
    const specs = [
      { name: 'watti-printed-taupe', color: 0x51463e, metalness: .02, roughness: .9 },
      { name: 'watti-motor-black', color: 0x171b1c, metalness: .24, roughness: .62 },
      { name: 'watti-steel-fasteners', color: 0x81898b, metalness: .8, roughness: .4 },
      { name: 'watti-copper-face', color: 0xb97846, metalness: .58, roughness: .48 },
      { name: 'watti-optics', color: 0x070d11, metalness: .12, roughness: .18 },
    ];
    const materials = specs.map(spec => new THREE.MeshStandardMaterial({ ...spec, side: THREE.DoubleSide }));
    this.resources.push(...materials); return materials;
  }
  private styleWattiMesh(mesh: THREE.Mesh, materials: THREE.MeshStandardMaterial[]) {
    // The six exported links each contain separate CAD solids. Classify whole
    // connected solids, preserving every original vertex and triangle winding.
    const geometry = mesh.geometry, positions = geometry.getAttribute('position'), index = geometry.index;
    if (!index) { mesh.material = materials[0]; return; }
    const parents = Int32Array.from({ length: positions.count }, (_, i) => i);
    const find = (value: number): number => {
      while (parents[value] !== value) { parents[value] = parents[parents[value]]; value = parents[value]; }
      return value;
    };
    for (let i = 0; i < index.count; i += 3) {
      const a = find(index.getX(i));
      parents[find(index.getX(i + 1))] = a; parents[find(index.getX(i + 2))] = a;
    }
    const sourceRoot = this.model.getObjectByName('ModelRoot') ?? this.model;
    const toSource = sourceRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    const boxes = new Map<number, THREE.Box3>(), point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      const id = find(i); let box = boxes.get(id);
      if (!box) { box = new THREE.Box3(); boxes.set(id, box); }
      box.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(toSource));
    }
    const materialFor = new Map<number, number>();
    for (const [id, box] of boxes) {
      const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      const largest = Math.max(size.x, size.y, size.z);
      let material = 1;
      if (mesh.name.includes('_head_link_')) {
        if (size.x > .1) material = 0; // Full conical printed shell.
        else if (size.y > .09 && size.z > .09) material = 3; // Circular front plates.
        else if (center.x > .075 && Math.abs(center.z - .3715) < .024) material = 4;
        else if (largest < .024) material = 2;
      } else if (mesh.name.includes('_base_link_')) {
        if ((size.x > .18 && size.y > .18) || (size.x > .06 && size.y > .06 && size.z > .045)) material = 0;
        else if (largest < .024) material = 2;
      } else {
        // Printed brackets span both sides of a joint; motor cans are narrower.
        if (size.y > .06 && size.z > .045) material = 0;
        else if (largest < .024) material = 2;
      }
      materialFor.set(id, material);
    }
    const bins: number[][] = materials.map(() => []);
    for (let i = 0; i < index.count; i += 3) {
      const bucket = bins[materialFor.get(find(index.getX(i))) ?? 0];
      bucket.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
    const reordered = new Uint32Array(index.count); let offset = 0;
    geometry.clearGroups();
    bins.forEach((bin, material) => {
      if (!bin.length) return;
      reordered.set(bin, offset); geometry.addGroup(offset, bin.length, material); offset += bin.length;
    });
    geometry.setIndex(new THREE.BufferAttribute(reordered, 1)); mesh.material = materials;
    mesh.userData.wattiMaterials = bins.map((bin, i) => ({ name: materials[i].name, triangles: bin.length / 3 }));
  }
  private setupWattiLight() {
    const head = this.joints.get('head_yaw')?.object ?? this.model.getObjectByName('body_head_link');
    const sourceRoot = this.model.getObjectByName('ModelRoot');
    if (!head || !sourceRoot) return;
    this.model.updateWorldMatrix(true, true);
    const sourceToHead = head.matrixWorld.clone().invert().multiply(sourceRoot.matrixWorld);
    // Fusion led_ring_origin and its +X normal; the CAD front lip is 10 mm ahead.
    const center = new THREE.Vector3(.09472861361890807, .0008928027369399152, .3714960623270964).applyMatrix4(sourceToHead);
    const normal = new THREE.Vector3(.9998086695946476, .012031826186414294, -.015422689843229124).transformDirection(sourceToHead);
    const lightRing = new THREE.Group(); lightRing.name = 'watti-head-led-ring';
    lightRing.position.copy(center).addScaledVector(normal, .0116);
    lightRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const geometry = new THREE.RingGeometry(.0535, .0655, 96, 4);
    const positions = geometry.getAttribute('position'), colors = new Float32Array(positions.count * 3);
    const warm = new THREE.Color(0xfff4dd), tint = new THREE.Color(), color = new THREE.Color();
    const stops = [0x76e7ee, 0x78a5f4, 0xca8bf0, 0xffe6b3, 0x76e7ee].map(value => new THREE.Color(value));
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), radius = Math.hypot(x, y);
      const u = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, segment = u * 4, k = Math.floor(segment);
      tint.copy(stops[k]).lerp(stops[k + 1], segment - k);
      const edge = Math.pow(Math.abs((radius - .0595) / .006), 3);
      color.copy(warm).lerp(tint, edge * .72); color.toArray(colors, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshStandardMaterial({ color: 0x181818, emissive: 0xffffff, emissiveIntensity: 1.08, vertexColors: true, metalness: 0, roughness: .7, side: THREE.DoubleSide, toneMapped: false });
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif');
    };
    material.customProgramCacheKey = () => 'watti-diffused-rgb-v1';
    const diffuser = new THREE.Mesh(geometry, material); diffuser.name = 'watti-led-diffuser';
    lightRing.add(diffuser); head.add(lightRing); this.resources.push(geometry, material);
    this.glow = new THREE.PointLight(0xffe6bd, .45, .95, 2);
    this.glow.position.z = .006; lightRing.add(this.glow);
  }
  private setupWattiCables() {
    const root = this.model.getObjectByName('ModelRoot'); if (!root) return;
    this.model.updateWorldMatrix(true, true);
    const anchor = (name: string, xyz: [number, number, number]): CableAnchor => {
      const node = this.model.getObjectByName(name); if (!node) throw new Error(`Missing Watti cable attachment: ${name}`);
      return { node, point: node.worldToLocal(root.localToWorld(new THREE.Vector3(...xyz))) };
    };
    // Lightweight visual looms, inferred from the supplied photo rather than CAD wiring.
    const pairs = [
      { start: anchor('body_base_link', [-.057, -.022, .034]), end: anchor('joint_shoulder_pitch', [-.022, -.025, .145]), slack: .035, radius: .0032 },
      { start: anchor('joint_shoulder_pitch', [-.021, -.024, .177]), end: anchor('joint_elbow_pitch', [-.011, -.024, .268]), slack: .025, radius: .0025 },
      { start: anchor('joint_elbow_pitch', [-.009, -.021, .277]), end: anchor('joint_head_yaw', [-.029, -.009, .389]), slack: .039, radius: .003 },
    ];
    const strands = pairs.map(pair => ({ ...pair, back: new THREE.Vector3(-1, 0, 0).transformDirection(pair.start.node.matrixWorld.clone().invert().multiply(root.matrixWorld)) }));
    const geometry = new THREE.BufferGeometry(), count = strands.length * 17 * 6;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const indices: number[] = [];
    for (let strand = 0; strand < strands.length; strand++) for (let segment = 0; segment < 16; segment++) for (let j = 0; j < 6; j++) {
      const a = strand * 17 * 6 + segment * 6 + j, b = strand * 17 * 6 + segment * 6 + (j + 1) % 6;
      indices.push(a, b, a + 6, b, b + 6, a + 6);
    }
    geometry.setIndex(indices);
    const material = new THREE.MeshStandardMaterial({ color: 0x111719, metalness: .04, roughness: .88 });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = 'watti-flexible-cables'; mesh.frustumCulled = false; mesh.castShadow = true;
    root.add(mesh); this.resources.push(geometry, material); this.cables = { root, mesh, strands };
    this.updateWattiCables();
  }
  private updateWattiCables() {
    if (!this.cables) return;
    this.model.updateWorldMatrix(true, true);
    const { root, mesh, strands } = this.cables, inverse = root.matrixWorld.clone().invert();
    const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute, normals = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const point = new THREE.Vector3(), tangent = new THREE.Vector3(), normal = new THREE.Vector3(), binormal = new THREE.Vector3(), offset = new THREE.Vector3();
    strands.forEach((strand, n) => {
      const a = strand.start.point.clone().applyMatrix4(strand.start.node.matrixWorld).applyMatrix4(inverse);
      const b = strand.end.point.clone().applyMatrix4(strand.end.node.matrixWorld).applyMatrix4(inverse);
      const back = strand.back.clone().transformDirection(strand.start.node.matrixWorld).transformDirection(inverse).multiplyScalar(strand.slack);
      // Keep the loom monotonic between its attachments when the elbow folds:
      // slack goes across the chord, never past an endpoint into a tight cusp.
      const chord = b.clone().sub(a), length = chord.length(); chord.divideScalar(Math.max(length, 1e-8));
      back.addScaledVector(chord, -back.dot(chord));
      if (back.lengthSq() < 1e-10) back.set(0, 1, 0).addScaledVector(chord, -chord.y);
      if (back.lengthSq() < 1e-10) back.set(1, 0, 0).addScaledVector(chord, -chord.x);
      back.normalize().multiplyScalar(Math.min(strand.slack, length * .45));
      const curve = new THREE.CubicBezierCurve3(a, a.clone().lerp(b, .32).add(back), a.clone().lerp(b, .68).add(back), b);
      normal.set(0, 1, 0);
      for (let segment = 0; segment <= 16; segment++) {
        curve.getPoint(segment / 16, point); curve.getTangent(segment / 16, tangent);
        if (tangent.lengthSq() < 1e-10) tangent.set(0, 0, 1);
        normal.addScaledVector(tangent, -normal.dot(tangent));
        if (normal.lengthSq() < 1e-10) normal.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
        normal.normalize(); binormal.crossVectors(tangent, normal).normalize();
        for (let j = 0; j < 6; j++) {
          const angle = j * Math.PI / 3, i = n * 17 * 6 + segment * 6 + j;
          offset.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle));
          positions.setXYZ(i, point.x + offset.x * strand.radius, point.y + offset.y * strand.radius, point.z + offset.z * strand.radius);
          normals.setXYZ(i, offset.x, offset.y, offset.z);
        }
      }
    });
    positions.needsUpdate = true; normals.needsUpdate = true;
  }
  private setupHead() {
    this.model.updateMatrixWorld(true);
    const head = this.model.getObjectByName('body_xl_330');
    if (!head || !head.parent) return;
    // Reparent the top platform preserving its rest pose, avoiding an open Stewart chain.
    const parent = this.model.getObjectByName('ModelRoot') ?? this.model;
    parent.attach(head); this.head = head;
    // Centroid of the six official platform attachment points, in head coordinates.
    const pivot = new THREE.Vector3(-.006944276666666667, .0037054795, .02913622883333333)
      .applyQuaternion(head.quaternion).add(head.position);
    this.headRest = { pos: head.position.clone(), quat: head.quaternion.clone(), pivot };
    this.solveRods = createReachyRodSolver(this.model, this.rig);
  }
  private setupSupport() {
    // Preserve the actual base contact surface when the player leans into a turn.
    const base = this.model.getObjectByName('body_body_foot_3dprint');
    if (!base) return;
    this.model.updateWorldMatrix(true, true);
    const inverse = this.model.matrixWorld.clone().invert(), point = new THREE.Vector3(), values: number[] = [];
    base.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object.name === 'ink-outline') return;
      const transform = inverse.clone().multiply(object.matrixWorld), positions = object.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(transform);
        values.push(point.x, point.y, point.z);
      }
    });
    this.support = new Float32Array(values);
  }
  /** May be called when a model instance is reused for a new match or role. */
  resetPose() {
    if (!this.model || !this.rig) return;
    this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0);
    this.model.position.set(0, 0, 0); this.model.quaternion.copy(this.modelRest);
    this.model.scale.setScalar((this.role === 'referee' ? 1.6 : 1.75) / this.rig.bounds.size[1]);
    for (const joint of this.joints.values()) joint.object.quaternion.copy(joint.rest);
    if (this.head && this.headRest) {
      this.head.position.copy(this.headRest.pos); this.head.quaternion.copy(this.headRest.quat);
      // The solver remembers the previous valid pose; reset that history as well.
      this.solveRods = createReachyRodSolver(this.model, this.rig);
      this.solveRods();
    }
    if (this.ring) { this.ring.visible = this.role === 'player'; this.ring.scale.setScalar(1); }
    this.renderedRole = this.role; this.lastTick = undefined;
    this.updateWattiCables();
  }
  private prepareFrame(role: RobotRole, tick: number) {
    const restarted = this.lastTick !== undefined && tick < this.lastTick;
    this.role = role;
    if (this.renderedRole !== role || restarted) this.resetPose();
    this.lastTick = tick;
  }
  private groundBase() {
    this.model.position.y = 0;
    if (!this.support.length) return;
    this.model.updateMatrix();
    const m = this.model.matrix.elements;
    let bottom = Infinity;
    for (let i = 0; i < this.support.length; i += 3) {
      bottom = Math.min(bottom, m[1] * this.support[i] + m[5] * this.support[i + 1] + m[9] * this.support[i + 2]);
    }
    this.model.position.y = -bottom;
  }
  private reachyPlayer(p: Player, s: MatchState, time: number, activity: number, celebrating: boolean) {
    const playing = s.phase === 'play', moving = playing ? activity : 0;
    const { windup, strike } = playing ? reachyActionPose(p) : { windup: 0, strike: 0 };
    const dx = s.ball.x - p.x, dz = s.ball.z - p.z;
    const tracking = clamp(Math.atan2(Math.sin(Math.atan2(dx, dz) - p.yaw), Math.cos(Math.atan2(dx, dz) - p.yaw)), -.85, .85);
    const lateral = clamp((Math.cos(p.yaw) * p.vx - Math.sin(p.yaw) * p.vz) / 3.25, -1, 1) * moving;
    const glide = Math.sin(p.distance * 3.1) * moving;
    const dance = celebrating ? Math.sin(time * 6) : 0;
    const bodyYaw = tracking * .09 * (1 - strike) + glide * .012 + dance * .1;
    this.setJoint('yaw_body', bodyYaw);

    // This robot has a fixed base: it glides, pivots and shifts its weight on the ground.
    const lean = moving * .02 - windup * .035 + strike * .075 + dance * .025;
    const bank = -lateral * .04 + (celebrating ? Math.sin(time * 8) * .035 : glide * .008);
    this.poseRotation.setFromEuler(this.poseEuler.set(lean, 0, bank, 'XYZ'));
    this.model.quaternion.copy(this.modelRest).premultiply(this.poseRotation);
    this.model.position.set(0, 0, -windup * .035 + strike * .085);
    this.groundBase();

    if (this.head && this.headRest) {
      // Work in the source-aligned platform frame: X forward, Y left, Z up.
      const roll = -lateral * .025 + (celebrating ? Math.sin(time * 8) * .055 : 0);
      const pitch = moving * .02 + Math.sin(time * 1.7) * .008 - windup * .11 + strike * .18 + dance * .09;
      const yaw = bodyYaw + tracking * .16 * (1 - strike * .8) + dance * .1;
      this.poseRotation.setFromEuler(this.poseEuler.set(roll, pitch, yaw, 'ZYX'));
      this.head.position.copy(this.headRest.pos).sub(this.headRest.pivot).applyQuaternion(this.poseRotation).add(this.headRest.pivot);
      this.head.position.x += -windup * .006 + strike * .014;
      this.head.position.z -= windup * .002 + strike * .003;
      this.head.quaternion.copy(this.headRest.quat).premultiply(this.poseRotation);
      this.solveRods?.();
    }
    const flutter = Math.sin(time * (celebrating ? 11 : 3.4)) * (celebrating ? .65 : .06 + moving * .09);
    this.setJoint('left_antenna', flutter - windup * .42 + strike * .48);
    this.setJoint('right_antenna', -flutter + windup * .42 - strike * .48 + (celebrating ? Math.sin(time * 9) * .15 : .035));
  }
  animate(p: Player, s: MatchState, time: number) {
    this.prepareFrame('player', s.tick);
    this.root.position.set(p.x, 0, p.z); this.root.rotation.set(0, p.yaw, 0);
    const speed = Math.hypot(p.vx, p.vz), activity = clamp(speed / 3.25, 0, 1);
    const phase = p.distance * (this.kind === 'watti' ? 7.4 : 8.8);
    const kick = p.action === 'none' ? 0 : Math.sin(clamp(p.actionTime / .46, 0, 1) * Math.PI);
    const strike = p.action === 'kick' ? Math.sin(clamp((p.actionTime - .04) / .3, 0, 1) * Math.PI) : 0;
    const celebrating = (s.phase === 'goal' || s.phase === 'finished') && (s.lastScorer === p.id || s.winner === p.id);
    (this.ring.material as THREE.MeshBasicMaterial).color.set(p.id === 0 ? 0x54d7d8 : 0xffa351);
    this.ring.visible = s.phase !== 'finished';
    if (this.kind === 'watti') {
      const hop = Math.max(0, Math.sin(phase)), squash = Math.cos(phase);
      const idle = p.action === 'none' && p.charge === 0 && !celebrating && s.phase !== 'paused' ? 1 - THREE.MathUtils.smoothstep(speed, 0, .65) : 0;
      const breath = Math.sin(time * 1.2 + p.id * 1.9) * idle, sway = Math.sin(time * .73 + p.id * .9) * idle;
      const hitting = p.action === 'kick' && (s.phase === 'play' || s.phase === 'paused');
      const hitStroke = hitting ? strike : 0;
      // Replace the running bounce during a shot; peak at the .19 s ball contact,
      // then land with zero vertical velocity before the running gait resumes.
      const shotWeight = hitting ? THREE.MathUtils.smoothstep(p.actionTime, 0, .07) * (1 - THREE.MathUtils.smoothstep(p.actionTime, .42, .54)) : 0;
      const hitHop = hitting ? .06 * (.65 + clamp(p.actionPower, 0, 1) * .35) * THREE.MathUtils.smoothstep(p.actionTime, .07, .19) * (1 - THREE.MathUtils.smoothstep(p.actionTime, .19, .42)) : 0;
      this.model.position.y = hop * .19 * activity * (1 - shotWeight) + hitHop + (celebrating ? Math.abs(Math.sin(time * 7)) * .25 : 0);
      // Fold the elbow the other way and balance shoulder/neck motion so the
      // combined head pitch stays +.16 rad toward the ball at full contact.
      this.setJoint('shoulder_pitch', -.1 + squash * .18 * activity - p.charge * .23 + hitStroke * .5 + breath * .025);
      this.setJoint('elbow_pitch', .15 - squash * .28 * activity + p.charge * .36 + hitStroke * .65 - breath * .04);
      this.setJoint('neck_pitch', -.06 + squash * .1 * activity - p.charge * .12 - hitStroke * .99 + breath * .015 + sway * .009);
      this.setJoint('base_yaw', Math.sin(phase * .5) * .055 * activity + (p.action === 'tap' ? kick * .8 : 0));
      const dx = s.ball.x - p.x, dz = s.ball.z - p.z;
      this.setJoint('head_yaw', clamp(Math.atan2(Math.sin(Math.atan2(dx, dz) - p.yaw), Math.cos(Math.atan2(dx, dz) - p.yaw)), -.4, .4) * .55 + (celebrating ? Math.sin(time * 9) * .35 : 0) + sway * .038);
      this.updateWattiCables();
    } else if (this.kind === 'reachy') {
      this.reachyPlayer(p, s, time, activity, celebrating);
    } else {
      for (const [side, offset] of [['left', 0], ['right', .5]] as const) {
        const stride = duckStep(p.distance, this.model.scale.x, offset);
        const legKick = side === 'right' ? (p.action === 'tap' ? kick * .55 : strike) : 0;
        const dx = stride.dx * activity * (1 - legKick) + .045 * legKick;
        const lift = stride.lift * activity * (1 - legKick) + .018 * legKick;
        const pose = duckLegPose(side, dx, lift);
        this.setJoint(`${side}_hip_pitch`, pose.hip);
        this.setJoint(`${side}_knee`, pose.knee);
        this.setJoint(`${side}_ankle`, pose.ankle);
        this.setJoint(`${side}_hip_roll`, side === 'left' ? .0873 : -.0873);
        this.setJoint(`${side}_hip_yaw`, 0);
      }
      this.setJoint('neck_pitch', .08 * activity - kick * .13);
      this.setJoint('head_pitch', -.08 * activity + Math.sin(time * 1.7) * .04);
      this.setJoint('head_roll', Math.sin(phase) * .045 * activity);
      this.setJoint('head_yaw', celebrating ? Math.sin(time * 6) * .5 : Math.sin(time * .8) * .04);
      this.model.position.y = -.001340127741 * this.model.scale.x + (celebrating ? Math.abs(Math.sin(time * 7)) * .14 : 0);
    }
  }
  referee(s: MatchState, time: number) {
    this.prepareFrame('referee', s.tick);
    this.root.position.set(0, .22, -5.65); this.root.rotation.set(0, 0, 0); this.ring.visible = false;
    this.model.position.set(0, 0, 0); this.model.quaternion.copy(this.modelRest);
    const yaw = clamp(Math.atan2(s.ball.x, s.ball.z + 5.65), -.85, .85);
    this.setJoint('yaw_body', -yaw * .25);
    const signal = s.phase === 'goal' || s.phase === 'finished' || s.phase === 'countdown';
    this.setJoint('left_antenna', Math.sin(time * (signal ? 11 : 2)) * (signal ? .6 : .12));
    this.setJoint('right_antenna', -Math.sin(time * (signal ? 11 : 2) + .7) * (signal ? .6 : .12));
    if (this.head && this.headRest) {
      this.head.position.copy(this.headRest.pos);
      this.head.quaternion.copy(this.headRest.quat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, signal ? Math.sin(time * 8) * .05 : .01, -yaw * .12)));
      this.solveRods?.();
    }
  }
  dispose() {
    const resources = new Set(this.resources);
    this.model?.traverse(o => { if (o instanceof THREE.Mesh && o.name !== 'ink-outline') resources.add(o.geometry); });
    resources.forEach(resource => resource.dispose()); this.glow?.dispose();
  }
}

