import type { GameEvent, RobotKind } from './sim';
export class Sound {
  private ctx?: AudioContext;
  private music?: HTMLAudioElement;
  private musicGain?: GainNode;
  private musicSource?: MediaElementAudioSourceNode;
  private track = 0;
  private stopped = false;
  private silent = false;
  private readonly tracks = ['/audio/garage-theme-01.mp3', '/audio/garage-theme-02.mp3'];
  get muted() { return this.silent; }
  set muted(value: boolean) { this.silent = value; this.syncMusic(); }
  unlock() {
    if (this.stopped) return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.music = new Audio(this.tracks[this.track]); this.music.preload = 'none';
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0;
      this.musicSource = this.ctx.createMediaElementSource(this.music);
      this.musicSource.connect(this.musicGain); this.musicGain.connect(this.ctx.destination);
      this.music.addEventListener('ended', this.nextTrack);
      document.addEventListener('visibilitychange', this.visibility);
    }
    void this.ctx.resume().catch(() => {}); this.syncMusic();
  }
  private syncMusic() {
    if (!this.ctx || !this.music || !this.musicGain || this.stopped) return;
    const audible = !this.silent && !document.hidden;
    const gain = this.musicGain.gain;
    gain.cancelScheduledValues(this.ctx.currentTime);
    gain.setTargetAtTime(audible ? .045 : 0, this.ctx.currentTime, .22);
    if (audible) void this.music.play().catch(() => { /* A later user gesture retries autoplay unlock. */ });
    else this.music.pause();
  }
  private visibility = () => this.syncMusic();
  private nextTrack = () => {
    if (!this.music || this.stopped) return;
    this.track = (this.track + 1) % this.tracks.length;
    this.music.src = this.tracks[this.track]; this.syncMusic();
  };
  private note(freq: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0, end = freq) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, start = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, start); o.frequency.exponentialRampToValueAtTime(Math.max(20, end), start + duration);
    g.gain.setValueAtTime(.0001, start); g.gain.exponentialRampToValueAtTime(volume, start + .006); g.gain.exponentialRampToValueAtTime(.0001, start + duration);
    o.connect(g); g.connect(c.destination); o.start(start); o.stop(start + duration + .02);
  }
  play(e: GameEvent) {
    if (e.type === 'skill') { this.note(280, .23, .045, 'sine', 0, 780); this.note(140, .16, .025, 'triangle', .06, 70); }
    if (e.type === 'kick') { this.note(155, .13, .14, 'triangle', 0, 45); this.note(700, .035, .025, 'square', 0, 150); }
    if (e.type === 'start') { this.note(1850, .17, .065, 'sine'); this.note(2100, .21, .04, 'sine', .02); }
    if (e.type === 'goal') [392, 494, 587, 784].forEach((f, i) => this.note(f, .22, .07, 'square', i * .11));
    if (e.type === 'finish') { this.note(1900, .15, .06); this.note(1900, .15, .06, 'sine', .24); this.note(1900, .35, .06, 'sine', .48); }
  }
  step(kind: RobotKind, running: boolean) {
    if (kind === 'reachy') this.note(310, .12, running ? .009 : .005, 'sine', 0, 190);
    else this.note(kind === 'watti' ? 90 : 240, .065, running ? .024 : .014, 'triangle', 0, 45);
  }
  dispose() {
    this.stopped = true; document.removeEventListener('visibilitychange', this.visibility);
    if (this.music) { this.music.pause(); this.music.removeEventListener('ended', this.nextTrack); this.music.removeAttribute('src'); this.music.load(); }
    this.musicSource?.disconnect(); this.musicGain?.disconnect(); void this.ctx?.close().catch(() => {});
  }
}
