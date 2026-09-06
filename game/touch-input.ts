import { clamp, type Input } from './sim';

export const TOUCH_LAYOUT_QUERY = '(any-pointer: coarse), (max-height: 600px) and (orientation: landscape)';
const PORTRAIT_QUERY = '(max-width: 600px) and (orientation: portrait), (any-pointer: coarse) and (orientation: portrait)';
export type TouchAction = 'charge' | 'tap' | 'sprint';

export function stickVector(x: number, y: number, radius: number) {
  const distance = Math.hypot(x, y), amount = Math.min(1, distance / Math.max(1, radius));
  const strength = amount < .12 ? 0 : (amount - .12) / .88;
  return { x: distance ? x / distance * strength : 0, z: distance ? y / distance * strength : 0,
    knobX: distance ? x / distance * amount * radius : 0, knobY: distance ? y / distance * amount * radius : 0 };
}

/** Pointer ownership keeps a lifted/cancelled finger from releasing another control. */
export class TouchInput {
  moveOwner: number | null = null;
  private x = 0;
  private z = 0;
  private actions = new Map<number, TouchAction>();
  private shoot = false;
  private tap = false;
  beginMove(pointer: number) {
    if (this.moveOwner !== null || this.actions.has(pointer)) return false;
    this.moveOwner = pointer; return true;
  }
  move(pointer: number, x: number, z: number) {
    if (pointer !== this.moveOwner) return;
    this.x = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
    this.z = Number.isFinite(z) ? clamp(z, -1, 1) : 0;
  }
  beginAction(pointer: number, action: TouchAction) {
    if (this.actions.has(pointer) || this.moveOwner === pointer) return false;
    this.actions.set(pointer, action);
    if (action === 'tap') this.tap = true;
    return true;
  }
  release(pointer: number, cancelled = false) {
    if (this.moveOwner === pointer) { this.moveOwner = null; this.x = this.z = 0; }
    const action = this.actions.get(pointer); this.actions.delete(pointer);
    if (action === 'charge' && !cancelled && !this.held('charge')) this.shoot = true;
  }
  held(action: TouchAction) { return [...this.actions.values()].includes(action); }
  pulse(action: TouchAction) {
    if (action === 'charge') this.shoot = true;
    else if (action === 'tap') this.tap = true;
    else if (this.actions.has(-2)) this.release(-2); else this.beginAction(-2, 'sprint');
  }
  read(): Omit<Input, 'seq'> { return { x: this.x, z: this.z, charge: this.held('charge'), sprint: this.held('sprint'), shoot: this.shoot, tap: this.tap }; }
  consumeEdges() { this.shoot = this.tap = false; }
  clear() { this.moveOwner = null; this.x = this.z = 0; this.actions.clear(); this.consumeEdges(); }
}

export function subscribeTouchLayout(change: () => void) {
  const media = window.matchMedia(TOUCH_LAYOUT_QUERY);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}
export const touchLayoutSnapshot = () => window.matchMedia(TOUCH_LAYOUT_QUERY).matches;
export const desktopSnapshot = () => false;
export function subscribePortrait(change: () => void) {
  const media = window.matchMedia(PORTRAIT_QUERY); media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}
export const portraitSnapshot = () => window.matchMedia(PORTRAIT_QUERY).matches;
