import * as THREE from 'three';
import { FIELD } from './sim';

const INK = 0x151b1c;
export type Arena = { root: THREE.Group; ball: THREE.Group; dispose: () => void };

export function buildArena(): Arena {
  const root = new THREE.Group();
  const resources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  const ink = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: .72 }); resources.push(ink);
  const texture = new THREE.TextureLoader().load('/textures/ink-metal.png');
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2); resources.push(texture);
  const mat = (color: number, roughness = .86, metalness = .05, textured = true) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, map: textured ? texture : undefined }); resources.push(m); return m;
  };
  const dark = mat(0x414b4d), steel = mat(0x879190, .66, .3), rust = mat(0xcd7944), yellow = mat(0xf1bd52), cyan = mat(0x3aabb1);
  const concrete = mat(0x9b9c85), timber = mat(0xa28b67), black = mat(0x252f31);
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, outline = true) {
    resources.push(geometry); const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; root.add(m);
    if (outline) { const e = new THREE.EdgesGeometry(geometry, 30); resources.push(e); m.add(new THREE.LineSegments(e, ink)); }
    return m;
  }
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, outline = true) => mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, outline);
  const cylinder = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number) => mesh(new THREE.CylinderGeometry(r, r, h, 10), m, x, y, z);
  function pipe(from: THREE.Vector3, to: THREE.Vector3, radius = .07, material = steel) {
    const p = mesh(new THREE.CylinderGeometry(radius, radius, from.distanceTo(to), 8), material, ...from.clone().add(to).multiplyScalar(.5).toArray() as [number, number, number]);
    p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()); return p;
  }
  function textPlane(text: string, w: number, h: number, bg: string, fg: string, x: number, y: number, z: number, font = 110) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = Math.round(1024 * h / w);
    const c = canvas.getContext('2d')!; c.fillStyle = bg; c.fillRect(0, 0, canvas.width, canvas.height);
    c.strokeStyle = '#172024'; c.lineWidth = 16; c.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    c.fillStyle = fg; c.font = `italic 900 ${font}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 512, canvas.height / 2, 960);
    const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; resources.push(t);
    const material = new THREE.MeshStandardMaterial({ map: t, roughness: .9 }); resources.push(material);
    return mesh(new THREE.PlaneGeometry(w, h), material, x, y, z, false);
  }
  // Raised painted-concrete pitch and dark rubber surround.
  box(20.7, .3, 14, dark, 0, -.36, 0);
  box(17.7, .12, 11.6, black, 0, -.15, 0);
  box(FIELD.x * 2, .12, FIELD.z * 2, mat(0x708e83, .99, 0), 0, -.045, 0);
  const marking = new THREE.MeshBasicMaterial({ color: 0xe8ddba }); resources.push(marking);
  const line = (w: number, d: number, x: number, z: number) => box(w, .009, d, marking, x, .024, z, false);
  line(.045, 8.65, 0, 0); line(14.6, .045, 0, -4.32); line(14.6, .045, 0, 4.32);
  line(.045, 8.65, -7.3, 0); line(.045, 8.65, 7.3, 0);
  const ring = mesh(new THREE.RingGeometry(1.27, 1.31, 64), marking, 0, .028, 0, false); ring.rotation.x = -Math.PI / 2;
  const center = mesh(new THREE.CircleGeometry(.09, 16), marking, 0, .03, 0, false); center.rotation.x = -Math.PI / 2;
  for (const side of [-1, 1]) {
    line(.045, 4.7, side * 5.2, 0); line(2.1, .045, side * 6.25, -2.35); line(2.1, .045, side * 6.25, 2.35);
    const teamMat = side < 0 ? cyan : rust;
    box(.16, .58, 3.05, teamMat, side * 7.7, .29, -3.07);
    box(.16, .58, 3.05, teamMat, side * 7.7, .29, 3.07);
    for (const z of [-FIELD.goal, FIELD.goal]) {
      pipe(new THREE.Vector3(side * FIELD.x, .03, z), new THREE.Vector3(side * FIELD.x, FIELD.height, z), .075, teamMat);
      pipe(new THREE.Vector3(side * FIELD.x, FIELD.height, z), new THREE.Vector3(side * 8.65, 1.15, z), .05, dark);
      pipe(new THREE.Vector3(side * 8.65, .04, z), new THREE.Vector3(side * 8.65, 1.15, z), .05, dark);
    }
    pipe(new THREE.Vector3(side * FIELD.x, FIELD.height, -FIELD.goal), new THREE.Vector3(side * FIELD.x, FIELD.height, FIELD.goal), .075, teamMat);
    for (let z = -1.5; z <= 1.51; z += .25) pipe(new THREE.Vector3(side * 8.65, .05, z), new THREE.Vector3(side * 8.65, 1.15, z), .009, steel);
    for (let y = .05; y <= 1.16; y += .22) pipe(new THREE.Vector3(side * 8.65, y, -1.5), new THREE.Vector3(side * 8.65, y, 1.5), .009, steel);
    const led = new THREE.MeshBasicMaterial({ color: side < 0 ? 0x52edf0 : 0xffac4c }); resources.push(led);
    box(.03, .045, 2.85, led, side * 7.78, .62, -3.09, false);
    box(.03, .045, 2.85, led, side * 7.78, .62, 3.09, false);
  }
  for (const z of [-4.7, 4.7]) {
    box(15.5, .52, .16, dark, 0, .26, z);
    for (let x = -7.2; x < 7.5; x += 1.8) {
      const stripe = box(.5, .12, .18, yellow, x, .32, z); stripe.rotation.z = -.24;
      box(.035, .55, .19, steel, x + .7, .27, z);
    }
  }
  // Workshop shell: back wall and exposed structural beams.
  box(23, 7, .25, concrete, 0, 3, -7.15);
  box(.3, 7, 16, concrete, -11.4, 3, 0);
  for (const x of [-10, -5, 0, 5, 10]) {
    box(.22, 7.3, .42, dark, x, 3.1, -6.88);
    box(.45, .22, 1.3, dark, x, 6.6, -6.3);
    for (let j = 0; j < 3; j++) { const caution = box(.24, .25, .46, yellow, x, .5 + j * .5, -6.88); caution.rotation.z = .12; }
  }
  for (const y of [.6, 2.4, 4.2, 6]) box(22.4, .025, .05, black, 0, y, -6.995, false);
  // Corrugated workshop door and central hand-painted sign.
  box(5.4, 3.65, .15, dark, 5.8, 1.75, -6.93);
  for (let y = .1; y < 3.6; y += .23) box(5.2, .06, .075, steel, 5.8, y, -6.82);
  const sign = textPlane('ROBOT LEAGUE', 5.3, 1.1, '#ddb75b', '#1b2428', -1.6, 4.5, -6.9, 110); sign.rotation.z = .035;
  textPlane('GARAGE ARENA / 01', 4, .45, '#2b393b', '#e7dcb8', -1.6, 3.72, -6.87, 65);
  textPlane('NO OIL. JUST GOALS.', 3.1, .65, '#7b8f83', '#253738', -6.8, 4.6, -6.96, 57).rotation.z = -.06;
  // Workbench, tool board, stools, cables, barrels, stacked supplies.
  box(4.1, .16, .9, timber, -5.8, 1.22, -6.1);
  for (const x of [-7.5, -4.1]) box(.12, 1.2, .65, dark, x, .55, -6.1);
  box(3.5, 1.35, .05, timber, -5.8, 2.25, -6.86);
  for (let i = 0; i < 9; i++) {
    const x = -7.25 + i * .35;
    box(.04, .32 + (i % 3) * .13, .06, steel, x, 2.1 + (i % 2) * .2, -6.76);
    if (i % 2 === 0) cylinder(.075, .15, rust, x, 1.42, -6.05);
  }
  for (const [x, z, color] of [[-9.7,-5.7,rust],[9.8,-5.9,cyan],[10.3,3.7,yellow]] as const) {
    cylinder(.4, 1.1, color, x, .5, z);
    for (const y of [.18, .78]) cylinder(.415, .04, dark, x, y, z);
  }
  for (let i = 0; i < 6; i++) box(.75, .58, .7, i % 2 ? timber : dark, 9 + (i % 2) * .85, .25 + Math.floor(i / 2) * .6, -6.1);
  for (let i = 0; i < 4; i++) cylinder(.24, .4, black, -9.6, .16 + i * .35, 2.9);
  pipe(new THREE.Vector3(-10.95, 4.7, -6.8), new THREE.Vector3(-10.95, 4.7, 5.7), .08, rust);
  pipe(new THREE.Vector3(-10.95, .1, 5.7), new THREE.Vector3(-10.95, 4.7, 5.7), .08, rust);
  // Judge's metal pedestal, outside the collision field.
  box(1.5, .25, 1.1, yellow, 0, .08, -5.65);
  textPlane('REFEREE', 1.3, .22, '#d7ad53', '#182328', 0, .14, -5.08, 120);
  // A real geometric football with black pentagons.
  const ball = new THREE.Group(); root.add(ball);
  const white = new THREE.MeshStandardMaterial({ color: 0xfff0c7, roughness: .77 }); resources.push(white);
  const ballGeometry = new THREE.SphereGeometry(FIELD.radius, 24, 16); resources.push(ballGeometry);
  const ballMesh = new THREE.Mesh(ballGeometry, white); ballMesh.castShadow = true; ball.add(ballMesh);
  const pentagonMat = new THREE.MeshStandardMaterial({ color: 0x202d31, roughness: .84 }); resources.push(pentagonMat);
  const ico = new THREE.IcosahedronGeometry(1, 0), pos = ico.getAttribute('position'), seen = new Set<string>();
  for (let i = 0; i < pos.count; i++) {
    const n = new THREE.Vector3().fromBufferAttribute(pos, i).normalize(), key = n.toArray().map(x => x.toFixed(3)).join();
    if (seen.has(key)) continue; seen.add(key);
    const g = new THREE.CircleGeometry(.054, 5); resources.push(g); const p = new THREE.Mesh(g, pentagonMat);
    p.position.copy(n.clone().multiplyScalar(FIELD.radius + .001)); p.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), n); ball.add(p);
  }
  ico.dispose();
  return { root, ball, dispose: () => { resources.forEach(r => r.dispose()); } };
}

