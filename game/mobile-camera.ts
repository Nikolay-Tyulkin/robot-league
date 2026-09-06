const target = { x: 0, y: .45, z: 0 };
const bounds = [
  [-7.78, 7.78, 0, .65, -4.78, 4.78], // Playing surface and low boards.
  [-8.76, 8.76, 0, 1.8, -1.6, 1.6], // Both complete goal frames and nets.
];

/** Fill the phone with the pitch; the referee and workshop may leave the frame. */
export function mobileCamera(width: number, height: number, overhead = false) {
  const angle = (overhead ? 62 : 46) * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle);
  const focal = height / (2 * Math.tan(43 * Math.PI / 360));
  const points = bounds.flatMap(([left, right, bottom, top, back, front]) =>
    [left, right].flatMap(x => [bottom, top].flatMap(y => [back, front].map(z => ({
      x: x - target.x, y: (y - target.y) * cos - (z - target.z) * sin, z: (y - target.y) * sin + (z - target.z) * cos,
    })))));
  const projection = (distance: number) => {
    const xs = points.map(p => focal * p.x / (distance - p.z));
    const ys = points.map(p => -focal * p.y / (distance - p.z));
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  };
  // Keep the scoreboard above play. Thumb controls overlay only the lower corners.
  const topInset = 52, bottomInset = 8, sideInset = 8;
  let low = Math.max(...points.map(p => p.z)) + .2, high = 150;
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2, p = projection(middle);
    if (p.right - p.left > width - sideInset * 2 || p.bottom - p.top > Math.max(60, height - topInset - bottomInset)) low = middle; else high = middle;
  }
  const distance = high * 1.005, p = projection(distance), safeCenterY = (topInset + height - bottomInset) / 2;
  return { position: { x: 0, y: target.y + distance * sin, z: target.z + distance * cos }, target, focal,
    offsetY: height / 2 - safeCenterY + (p.top + p.bottom) / 2 };
}
