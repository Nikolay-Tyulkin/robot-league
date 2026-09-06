import * as THREE from 'three';
import { buildArena, type Arena } from './arena';
import { Robot } from './robots';
import { Sound } from './sound';
import { createMatch, step, idleInput, aiInput, DT, clamp, ROBOT_KINDS, ROBOT_NAMES, selectSoloOpponent, type MatchState, type Input, type RobotKind, type SoloOpponent } from './sim';
import { TouchInput, TOUCH_LAYOUT_QUERY } from './touch-input';
import { mobileCamera } from './mobile-camera';

type Particle = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; max: number };
export type EngineInfo = { state: MatchState; mode: 'demo' | 'solo' | 'online'; player: number; fps: number };
export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(43, 1, .1, 100);
  private arena: Arena;
  private robots = new Map<string, Robot>();
  private texture: THREE.Texture;
  private frame = 0;
  private last = 0;
  private accumulator = 0;
  private hudTime = 0;
  private onlineTime = 0;
  private lastEvent = 0;
  private sequence = 0;
  private keys = new Set<string>();
  private shot = false;
  private tap = false;
  private disposed = false;
  private particles: Particle[] = [];
  private particleGeometry = new THREE.IcosahedronGeometry(.065, 0);
  private stepDistance = [0, 0];
  private fps = 60;
  private resizeObserver: ResizeObserver;
  private prediction = { x: 0, z: 0, vx: 0, vz: 0, ready: false };
  private receivedAt = 0;
  private previousState?: MatchState;
  private pausedPhase: MatchState['phase'] = 'play';
  private cameraMode = 0;
  private controlsBlocked = false;
  private mobileMedia = window.matchMedia(TOUCH_LAYOUT_QUERY);
  private compact = false;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private referenceHeight = 0;
  private mobileFrame?: ReturnType<typeof mobileCamera>;
  mode: EngineInfo['mode'] = 'demo';
  state = createMatch();
  player = 0;
  ready = false;
  sound = new Sound();
  onInput?: (input: Input) => void;
  constructor(private host: HTMLDivElement, private onInfo: (info: EngineInfo) => void, private onLoaded: (message?: string) => void, readonly touch = new TouchInput()) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobileMedia.matches ? 1.25 : 1.7));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.55;
    this.renderer.domElement.setAttribute('aria-label', '3D garage football arena'); this.host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x303d3d); this.scene.fog = new THREE.Fog(0x303d3d, 26, 57);
    this.scene.add(new THREE.HemisphereLight(0xc7e3df, 0x6a4e30, 2.15));
    const sun = new THREE.DirectionalLight(0xffe3b4, 3.4); sun.position.set(-3, 11, 5); sun.castShadow = true;
    const shadowSize = this.mobileMedia.matches ? 1024 : 2048;
    sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.camera.left = -13; sun.shadow.camera.right = 13; sun.shadow.camera.top = 11; sun.shadow.camera.bottom = -11;
    sun.shadow.camera.near = .5; sun.shadow.camera.far = 35; sun.shadow.normalBias = .028; sun.shadow.bias = -.0003; this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x77dce0, 1.2); rim.position.set(4, 5, -5); this.scene.add(rim);
    this.arena = buildArena(); this.scene.add(this.arena.root);
    this.texture = new THREE.TextureLoader().load('/textures/ink-metal.png'); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.camera.position.set(11.2, 12.8, 17.6); this.camera.lookAt(1, 0, -.6);
    this.resizeObserver = new ResizeObserver(this.resize); this.resizeObserver.observe(host); this.resize();
    this.mobileMedia.addEventListener('change', this.resize);
    window.addEventListener('keydown', this.keyDown); window.addEventListener('keyup', this.keyUp); window.addEventListener('blur', this.blur); document.addEventListener('visibilitychange', this.visibility);
    this.state.phase = 'play'; this.state.players[0].x = -2.8; this.state.players[1].x = 2.8;
    this.frame = requestAnimationFrame(this.loop);
    void this.load();
  }
  private async load() {
    try {
      const models: {key: string; kind: RobotKind; role: 'player' | 'referee'}[] = ROBOT_KINDS.flatMap(kind => [0, 1].map(player => ({key: `${player}:${kind}`, kind, role: 'player' as const})));
      models.push({key: 'referee', kind: 'reachy', role: 'referee'});
      await Promise.all(models.map(async ({key, kind, role}) => {
        const robot = new Robot(kind, role); await robot.load(this.texture);
        if (this.disposed) { robot.dispose(); return; }
        robot.root.visible = false; this.robots.set(key, robot); this.scene.add(robot.root);
      }));
      if (!this.disposed) { this.ready = true; this.onLoaded(); }
    } catch (e) { if (!this.disposed) this.onLoaded(e instanceof Error ? e.message : 'Unable to load the robots'); }
  }
  private resize = () => {
    const { width, height } = this.host.getBoundingClientRect();
    this.compact = this.mobileMedia.matches && width > height;
    if (Math.abs(width - this.viewportWidth) > 2 || !this.referenceHeight) this.referenceHeight = height;
    else this.referenceHeight = Math.min(this.referenceHeight, height);
    this.viewportWidth = width; this.viewportHeight = height;
    this.mobileFrame = this.compact ? mobileCamera(width, this.referenceHeight, this.cameraMode === 1) : undefined;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobileMedia.matches ? 1.25 : 1.7));
    this.renderer.setSize(width, height); this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
  };
  clearControls() { this.keys.clear(); this.shot = this.tap = false; this.touch.clear(); this.onInput?.({ ...idleInput(), seq: ++this.sequence }); }
  setControlsBlocked(blocked: boolean) { this.controlsBlocked = blocked; if (blocked) this.clearControls(); }
  cycleCamera() { this.cameraMode = (this.cameraMode + 1) % 2; this.resize(); }
  private editable = (e: KeyboardEvent) => (e.target as HTMLElement)?.closest('input,textarea,select,[role="dialog"],button');
  private keyDown = (e: KeyboardEvent) => {
    if (this.editable(e) || this.controlsBlocked) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
    if (e.code === 'KeyE' && !e.repeat) this.tap = true;
    if (e.code === 'KeyC' && !e.repeat) this.cycleCamera();
    if (e.code === 'Escape' && !e.repeat && this.mode === 'solo') this.pause();
  };
  private keyUp = (e: KeyboardEvent) => { if (e.code === 'Space' && this.keys.has('Space')) this.shot = true; this.keys.delete(e.code); };
  private blur = () => { this.clearControls(); if (this.mode === 'solo' && this.state.phase === 'play') this.pause(); };
  private visibility = () => { if (document.hidden) this.blur(); this.last = 0; this.accumulator = 0; };
  private input(): Input {
    if (this.controlsBlocked) return { ...idleInput(), seq: ++this.sequence };
    const has = (...codes: string[]) => codes.some(k => this.keys.has(k));
    const touch = this.touch.read();
    return { seq: ++this.sequence, x: clamp(Number(has('KeyD', 'ArrowRight')) - Number(has('KeyA', 'ArrowLeft')) + touch.x, -1, 1), z: clamp(Number(has('KeyS', 'ArrowDown')) - Number(has('KeyW', 'ArrowUp')) + touch.z, -1, 1), sprint: has('ShiftLeft', 'ShiftRight') || touch.sprint, charge: has('Space') || touch.charge, shoot: this.shot || touch.shoot, tap: this.tap || touch.tap };
  }
  startSolo(kind: RobotKind, name: string, choice: SoloOpponent = 'random') {
    const opponent = selectSoloOpponent(choice, kind);
    this.mode = 'solo'; this.player = 0; this.state = createMatch(kind, [name || 'Player', `${ROBOT_NAMES[opponent]} · AI`], opponent);
    this.robots.forEach(robot => robot.resetPose());
    this.lastEvent = 0; this.clearControls(); this.onInput = undefined; this.stepDistance = [0, 0]; this.sound.unlock(); this.notify();
  }
  startOnline(player: number) { this.player = player; this.mode = 'online'; this.robots.forEach(robot => robot.resetPose()); this.prediction.ready = false; this.previousState = undefined; this.lastEvent = 0; this.stepDistance = [0, 0]; this.sound.unlock(); this.clearControls(); }
  snapshot(state: MatchState) {
    const restarted = state.tick < this.state.tick;
    if (restarted) { this.lastEvent = 0; this.stepDistance = [0, 0]; this.prediction.ready = false; this.robots.forEach(robot => robot.resetPose()); }
    this.previousState = restarted ? state : this.state; this.state = state; this.receivedAt = performance.now();
    const p = state.players[this.player], local = this.prediction;
    if (!local.ready || state.phase !== 'play' || Math.hypot(local.x - p.x, local.z - p.z) > 1) Object.assign(local, { x: p.x, z: p.z, vx: p.vx, vz: p.vz, ready: true });
    else { local.x += (p.x - local.x) * .45; local.z += (p.z - local.z) * .45; }
  }
  menu() { this.mode = 'demo'; this.state = createMatch(); this.state.phase = 'play'; this.robots.forEach(robot => robot.resetPose()); this.clearControls(); this.lastEvent = 0; this.notify(); }
  pause() { if (this.mode !== 'solo' || this.state.phase === 'finished') return; if (this.state.phase === 'paused') this.state.phase = this.pausedPhase; else { this.pausedPhase = this.state.phase; this.state.phase = 'paused'; } this.clearControls(); this.notify(); }
  private notify() { this.onInfo({ state: this.state, mode: this.mode, player: this.player, fps: this.fps }); }
  private loop = (now: number) => {
    if (this.disposed) return;
    const elapsed = this.last ? Math.min((now - this.last) / 1000, .08) : DT; this.last = now;
    this.fps += ((1 / Math.max(.001, elapsed)) - this.fps) * .035;
    this.accumulator += elapsed;
    if (this.ready) {
      if (this.mode === 'demo') {
        this.accumulator = 0;
        Object.assign(this.state.players[0], { x: 1.2, z: 1.2, yaw: .55, vx: 0, vz: 0, distance: 0 });
        Object.assign(this.state.players[1], { x: 3.9, z: 0, yaw: .2, vx: 0, vz: 0, distance: 0 });
        Object.assign(this.state.ball, { x: 2.2, y: .18, z: 2.1 });
      } else if (this.mode !== 'online') {
        while (this.accumulator >= DT) {
          const input = this.input();
          step(this.state, [input, aiInput(this.state, 1)]);
          this.shot = this.tap = false; this.touch.consumeEdges(); this.accumulator -= DT;
        }
      } else {
        this.accumulator = 0;
        const i = this.input(), p = this.prediction;
        if (this.state.phase === 'play') {
          const len = Math.max(1, Math.hypot(i.x, i.z)), speed = (i.sprint && this.state.players[this.player].energy > .03 ? 4.8 : 3.25) * (i.charge ? .72 : 1), a = 1 - Math.exp(-11 * elapsed);
          p.vx += (i.x / len * speed - p.vx) * a; p.vz += (i.z / len * speed - p.vz) * a;
          p.x = clamp(p.x + p.vx * elapsed, -7.14, 7.14); p.z = clamp(p.z + p.vz * elapsed, -4.14, 4.14);
        }
        this.onlineTime += elapsed;
        if (this.onlineTime >= 1 / 30 || i.shoot || i.tap) { this.onInput?.(i); this.onlineTime = 0; this.shot = this.tap = false; this.touch.consumeEdges(); }
      }
      this.renderState(now / 1000);
    }
    this.updateParticles(elapsed);
    const mobileFrame = this.mode !== 'demo' ? this.mobileFrame : undefined;
    const mobileDemo = this.compact && this.mode === 'demo';
    const target = mobileFrame ? new THREE.Vector3(mobileFrame.position.x, mobileFrame.position.y, mobileFrame.position.z) : mobileDemo ? new THREE.Vector3(6.4, 6.4, 10.4) : this.mode === 'demo' ? new THREE.Vector3(8, 8.3, 13) : this.cameraMode ? new THREE.Vector3(0, 19.5, 10) : new THREE.Vector3(0, 13.4, 17.2);
    if (!mobileFrame && this.camera.aspect < 1.25) target.multiplyScalar(1.35);
    this.camera.position.lerp(target, 1 - Math.exp(-elapsed * 2));
    if (mobileFrame) {
      this.camera.fov = 2 * Math.atan(this.viewportHeight / (2 * mobileFrame.focal)) * 180 / Math.PI;
      this.camera.setViewOffset(this.viewportWidth, this.viewportHeight, 0, mobileFrame.offsetY, this.viewportWidth, this.viewportHeight);
      this.camera.lookAt(mobileFrame.target.x, mobileFrame.target.y, mobileFrame.target.z);
    } else if (this.mode === 'demo') {
      this.camera.fov = 43; this.camera.setViewOffset(this.viewportWidth, this.viewportHeight, -this.viewportWidth * .2, 0, this.viewportWidth, this.viewportHeight);
      this.camera.lookAt(1.8, .8, -.5);
    } else { this.camera.fov = 43; this.camera.clearViewOffset(); this.camera.lookAt(0, 0, -.45); }
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    this.hudTime += elapsed; if (this.hudTime > .1) { this.hudTime = 0; this.notify(); }
    this.frame = requestAnimationFrame(this.loop);
  };
  private renderState(time: number) {
    const s = this.state, alpha = clamp((performance.now() - this.receivedAt) / 50, 0, 1);
    this.robots.forEach(robot => { robot.root.visible = false; });
    for (const p of s.players) {
      let displayed = p;
      if (this.mode === 'online') {
        const previous = this.previousState?.players[p.id] ?? p;
        const turn = Math.atan2(Math.sin(p.yaw - previous.yaw), Math.cos(p.yaw - previous.yaw));
        displayed = { ...p, x: previous.x + (p.x - previous.x) * alpha, z: previous.z + (p.z - previous.z) * alpha,
          yaw: previous.yaw + turn * alpha, distance: previous.distance + (p.distance - previous.distance) * alpha,
          actionTime: previous.action === p.action ? previous.actionTime + (p.actionTime - previous.actionTime) * alpha : p.actionTime };
        if (p.id === this.player && this.prediction.ready) Object.assign(displayed, { x: this.prediction.x, z: this.prediction.z });
      }
      const robot = this.robots.get(`${p.id}:${p.kind}`);
      if (robot) { robot.root.visible = true; robot.root.scale.setScalar(this.mode === 'demo' ? 1.4 : 1); robot.animate(displayed, s, time); }
      if (p.distance - this.stepDistance[p.id] > (p.kind === 'watti' ? .84 : .71)) {
        this.stepDistance[p.id] = p.distance;
        if (this.mode !== 'demo' && s.phase === 'play') this.sound.step(p.kind, Math.hypot(p.vx, p.vz) > 3.4);
        if (Math.hypot(p.vx, p.vz) > 2) this.burst(p.x, .06, p.z, 3, false);
      }
    }
    const referee = this.robots.get('referee');
    if (referee) { referee.root.visible = true; referee.referee(s, time); }
    const b = s.ball, prev = this.mode === 'online' ? this.previousState?.ball ?? b : b;
    this.arena.ball.position.set(THREE.MathUtils.lerp(prev.x, b.x, alpha), THREE.MathUtils.lerp(prev.y, b.y, alpha), THREE.MathUtils.lerp(prev.z, b.z, alpha));
    this.arena.ball.rotation.set(b.spin * .3, b.spin * .2, -b.spin);
    for (const e of s.events) if (e.id > this.lastEvent) {
      if (this.mode !== 'demo') this.sound.play(e);
      if (e.type === 'goal') this.burst(e.x, .7, e.z, 38, true);
      if (e.type === 'kick') this.burst(e.x, .2, e.z, 9, false);
      this.lastEvent = e.id;
    }
  }
  private burst(x: number, y: number, z: number, count: number, colorful: boolean) {
    if (this.particles.length > 100) return;
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({ color: colorful ? [0xe8b84e,0x58c9ca,0xe97941][i % 3] : 0xc3b18a, transparent: true, opacity: .8 });
      const mesh = new THREE.Mesh(this.particleGeometry, material); mesh.position.set(x, y, z); this.scene.add(mesh);
      const life = colorful ? 1.6 : .48;
      this.particles.push({ mesh, life, max: life, velocity: new THREE.Vector3((Math.random() - .5) * 4, Math.random() * (colorful ? 5 : 1.2), (Math.random() - .5) * 4) });
    }
  }
  private updateParticles(dt: number) {
    this.particles = this.particles.filter(p => {
      p.life -= dt; if (p.life <= 0) { this.scene.remove(p.mesh); (p.mesh.material as THREE.Material).dispose(); return false; }
      p.velocity.y -= dt * 5; p.mesh.position.addScaledVector(p.velocity, dt); p.mesh.position.y = Math.max(.03, p.mesh.position.y);
      p.mesh.rotation.x += dt * 3; (p.mesh.material as THREE.MeshBasicMaterial).opacity = .75 * p.life / p.max; return true;
    });
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect();
    this.mobileMedia.removeEventListener('change', this.resize); this.touch.clear();
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp); window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility);
    this.robots.forEach(r => r.dispose()); this.arena.dispose(); this.texture.dispose(); this.particleGeometry.dispose();
    this.particles.forEach(p => (p.mesh.material as THREE.Material).dispose()); this.sound.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}

