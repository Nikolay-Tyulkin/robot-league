import assert from 'node:assert/strict';
import test from 'node:test';
import { Sound } from '../game/sound';

void test('background music waits for interaction, stays quiet, cycles tracks and follows mute/visibility', async t => {
  class Page extends EventTarget { hidden = false; }
  class Media extends EventTarget {
    static instances: Media[] = [];
    paused = true; preload = ''; plays = 0; unloaded = false;
    constructor(public src: string) { super(); Media.instances.push(this); }
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute(name: string) { if (name === 'src') this.src = ''; }
    load() { this.unloaded = true; }
  }
  class Context {
    static instances: Context[] = [];
    currentTime = 0; destination = {}; closed = false;
    gain = { value: 0, target: 0, cancelScheduledValues() {}, setTargetAtTime(value: number) { this.target = value; } };
    constructor() { Context.instances.push(this); }
    createGain() { return {gain: this.gain, connect() {}, disconnect() {}}; }
    createMediaElementSource() { return {connect() {}, disconnect() {}}; }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
  }
  const page = new Page();
  for (const [name, value] of Object.entries({document: page, Audio: Media, AudioContext: Context})) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {value, configurable:true});
    t.after(() => { if (descriptor) Object.defineProperty(globalThis,name,descriptor); else Reflect.deleteProperty(globalThis,name); });
  }
  const sound = new Sound();
  assert.equal(Media.instances.length, 0, 'no autoplay or download before a user gesture');
  sound.unlock();
  const media = Media.instances[0], context = Context.instances[0], firstTrack = media.src;
  assert.equal(media.paused, false);
  assert.ok(context.gain.target > 0 && context.gain.target <= .05, 'music stays below five percent gain');
  media.dispatchEvent(new Event('ended')); assert.notEqual(media.src, firstTrack);
  media.dispatchEvent(new Event('ended')); assert.equal(media.src, firstTrack, 'two tracks repeat as a playlist');
  sound.muted = true; assert.equal(media.paused,true); assert.equal(context.gain.target,0);
  sound.unlock(); assert.equal(media.paused,true, 'interaction does not override mute');
  sound.muted = false; assert.equal(media.paused,false);
  page.hidden = true; page.dispatchEvent(new Event('visibilitychange')); assert.equal(media.paused,true);
  page.hidden = false; page.dispatchEvent(new Event('visibilitychange')); assert.equal(media.paused,false);
  assert.equal(Media.instances.length,1, 'repeated interactions do not create overlapping players');
  sound.dispose(); const plays = media.plays;
  media.dispatchEvent(new Event('ended')); page.dispatchEvent(new Event('visibilitychange')); sound.unlock();
  assert.equal(media.plays,plays); assert.equal(media.paused,true); assert.equal(media.unloaded,true); assert.equal(context.closed,true);
});
