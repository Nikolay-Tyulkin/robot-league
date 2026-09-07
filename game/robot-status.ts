import * as THREE from 'three';

type Status = 'slowed' | 'dazzled';
type StatusArt = { label: THREE.SpriteMaterial; mark: THREE.SpriteMaterial };
const INK = '#11191b';
const COLORS = { slowed: '#f2bd50', dazzled: '#f3e6c8' };

function texture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Robot status graphics require a 2D canvas');
  draw(context);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.minFilter = THREE.LinearFilter; map.magFilter = THREE.LinearFilter; map.generateMipmaps = false;
  return map;
}

function glyph(context: CanvasRenderingContext2D, status: Status, x: number, y: number, size: number, outline: boolean) {
  context.save(); context.translate(x, y); context.scale(size / 80, size / 80);
  context.lineJoin = 'round'; context.lineCap = 'round';
  if (status === 'slowed') {
    // Two downward chevrons stay distinct from the rotating dazzle stars.
    context.beginPath();
    for (const offset of [-19, 8]) { context.moveTo(-24, offset - 7); context.lineTo(0, offset + 12); context.lineTo(24, offset - 7); }
    if (outline) { context.lineWidth = 18; context.strokeStyle = INK; context.stroke(); }
    context.lineWidth = 10; context.strokeStyle = outline ? COLORS.slowed : INK; context.stroke();
  } else {
    context.beginPath(); context.moveTo(0, -34); context.lineTo(9, -10); context.lineTo(32, 0);
    context.lineTo(9, 10); context.lineTo(0, 34); context.lineTo(-9, 10);
    context.lineTo(-32, 0); context.lineTo(-9, -10); context.closePath();
    context.fillStyle = outline ? COLORS.dazzled : INK; context.fill();
    if (outline) { context.lineWidth = 6; context.strokeStyle = INK; context.stroke(); }
  }
  context.restore();
}

function material(map: THREE.CanvasTexture) {
  return new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
}

function createArt(status: Status): StatusArt {
  const label = texture(512, 128, context => {
    // A clipped-corner ink panel keeps small text readable over both goals.
    context.beginPath(); context.moveTo(24, 13); context.lineTo(481, 13);
    context.lineTo(501, 31); context.lineTo(496, 108); context.lineTo(31, 115);
    context.lineTo(11, 96); context.closePath();
    context.fillStyle = COLORS[status]; context.fill();
    context.strokeStyle = INK; context.lineWidth = 12; context.lineJoin = 'round'; context.stroke();
    if (status === 'dazzled') {
      context.beginPath(); context.moveTo(108, 103); context.lineTo(478, 98);
      context.lineWidth = 7; context.strokeStyle = '#59d2d7'; context.stroke();
    }
    glyph(context, status, 66, 64, 69, false);
    context.font = '900 65px Impact, "Arial Narrow", sans-serif';
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = INK;
    context.fillText(status === 'slowed' ? 'SLOWED' : 'DAZZLED', 295, 67, 369);
  });
  const mark = texture(96, 96, context => glyph(context, status, 48, 48, 89, true));
  return { label: material(label), mark: material(mark) };
}

/** Presentation only: authoritative remaining time also freezes the orbit on pause. */
export class RobotStatusEffect {
  readonly root = new THREE.Group();
  private readonly art: Record<Status, StatusArt>;
  private readonly label: THREE.Sprite;
  private readonly marks: THREE.Sprite[];
  private readonly viewPosition = new THREE.Vector3();
  private disposed = false;

  constructor() {
    this.root.name = 'robot-status'; this.root.visible = false;
    this.art = { slowed: createArt('slowed'), dazzled: createArt('dazzled') };
    this.label = new THREE.Sprite(this.art.slowed.label);
    this.label.name = 'robot-status-label'; this.label.scale.set(1.65, .38, 1);
    this.label.position.y = .25; this.label.renderOrder = 30;
    this.marks = Array.from({ length: 3 }, (_, i) => {
      const mark = new THREE.Sprite(this.art.slowed.mark);
      mark.name = `robot-status-mark-${i}`; mark.scale.setScalar(i === 1 ? .25 : .22);
      mark.renderOrder = 29; return mark;
    });
    this.root.add(this.label, ...this.marks);
  }

  update(status: Status | null, remaining: number, anchorY: number) {
    this.root.visible = !this.disposed && status !== null && remaining > 0;
    if (!this.root.visible || status === null) return;
    this.root.position.set(0, anchorY, 0);
    const art = this.art[status], opacity = THREE.MathUtils.smoothstep(remaining, 0, .1);
    const elapsed = Math.max(0, (status === 'slowed' ? .55 : 1.2) - remaining);
    this.label.material = art.label; art.label.opacity = opacity; art.mark.opacity = opacity;
    art.mark.rotation = status === 'dazzled' ? elapsed * 1.5 : 0;
    this.marks.forEach((mark, i) => {
      const angle = elapsed * (status === 'dazzled' ? 6 : 3) + i * Math.PI * 2 / 3;
      mark.material = art.mark;
      mark.position.set(Math.cos(angle) * .57, -.04 + Math.sin(angle * 2) * .09, Math.sin(angle) * .35);
    });
  }

  fit(camera: THREE.PerspectiveCamera, viewportHeight: number) {
    if (!this.root.visible) return;
    this.label.getWorldPosition(this.viewPosition).applyMatrix4(camera.matrixWorldInverse);
    const unitsPerPixel = Math.max(0, -this.viewPosition.z) * 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, viewportHeight);
    // Keep short-lived status text readable even when phone framing shrinks bots.
    const scale = THREE.MathUtils.clamp(unitsPerPixel * 22 / .38, 1, 3);
    this.label.scale.set(1.65 * scale, .38 * scale, 1);
    this.label.position.y = .25 + .19 * (scale - 1);
    this.marks.forEach((mark, i) => mark.scale.setScalar(Math.max(i === 1 ? .25 : .22, Math.min(.5, unitsPerPixel * 8))));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.root.visible = false; this.root.removeFromParent(); this.root.clear();
    for (const art of Object.values(this.art)) {
      art.label.map?.dispose(); art.mark.map?.dispose(); art.label.dispose(); art.mark.dispose();
    }
    // THREE.Sprite shares its internal geometry; it is not owned by this effect.
  }
}
