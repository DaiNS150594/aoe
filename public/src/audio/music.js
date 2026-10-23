// Background music: the original Rise of Rome MIDI tracks (open.mid in the
// menus, music1..16 during the game, won/lost at the end) played through the
// Windows GS wavetable bank (gm.dls) — what the game sounded like on Windows —
// by a small WebAudio sampler.
import { parseMidi } from './midi.js';
import { parseDls } from './dls.js';

const db = (x) => 10 ** (x / 20);

export class MidiSynth {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.bank = null;
    this.index = new Map();
    this.buffers = [];
    this.timer = null;
    this.voices = new Set();
  }
  setBank(dls) {
    this.bank = dls;
    for (const ins of dls.instruments) {
      const key = `${ins.drum ? 1 : 0}:${ins.bank}:${ins.program}`;
      if (!this.index.has(key)) this.index.set(key, ins);
    }
  }
  instrument(drum, bank, program) {
    const d = drum ? 1 : 0;
    return this.index.get(`${d}:${bank}:${program}`) || this.index.get(`${d}:0:${program}`) || this.index.get(`${d}:0:0`);
  }
  buffer(i) {
    let buf = this.buffers[i];
    if (!buf) {
      const w = this.bank.waves[i];
      buf = this.ctx.createBuffer(1, Math.max(1, w.data.length), w.rate);
      buf.copyToChannel(w.data, 0);
      this.buffers[i] = buf;
    }
    return buf;
  }

  play(song, onEnd) {
    this.stop();
    this.song = song;
    this.pos = 0;
    this.t0 = this.ctx.currentTime + 0.2;
    this.onEnd = onEnd;
    this.channels = Array.from({ length: 16 }, (_, ch) => this.channel(ch));
    this.timer = setInterval(() => this.pump(), 60);
    this.pump();
  }
  channel(ch) {
    const gain = this.ctx.createGain(), panner = this.ctx.createStereoPanner();
    gain.connect(panner); panner.connect(this.out);
    const c = { ch, drum: ch === 9, program: 0, bank: 0, vol: 100, expr: 127, sustain: false, bend: 0, held: [], notes: new Map(), gain, panner };
    gain.gain.value = this.channelGain(c);
    return c;
  }
  channelGain(c) { return (c.vol / 127) ** 2 * (c.expr / 127) ** 2; }

  pump() {
    if (!this.song) return;
    const ctx = this.ctx, ev = this.song.events, horizon = ctx.currentTime + 0.5;
    while (this.pos < ev.length && this.t0 + ev[this.pos].t < horizon) {
      const e = ev[this.pos++];
      this.handle(e, Math.max(ctx.currentTime, this.t0 + e.t));
    }
    if (this.pos >= ev.length && ctx.currentTime > this.t0 + this.song.duration + 2.5) {
      const cb = this.onEnd;
      this.stop();
      if (cb) cb();
    }
  }
  handle(e, when) {
    const c = this.channels[e.ch];
    switch (e.type) {
      case 'on': this.noteOn(c, e.a, e.b, when); break;
      case 'off': this.noteOff(c, e.a, when); break;
      case 'prog': c.program = e.a; break;
      case 'bend':
        c.bend = (e.a / 8192) * 2; // +-2 semitones
        if (!c.drum) for (const list of c.notes.values()) for (const v of list) v.src.playbackRate.setValueAtTime(2 ** ((v.cents + c.bend * 100) / 1200), when);
        break;
      case 'cc':
        if (e.a === 0) c.bank = e.b;
        else if (e.a === 7 || e.a === 11) { if (e.a === 7) c.vol = e.b; else c.expr = e.b; c.gain.gain.setValueAtTime(this.channelGain(c), when); }
        else if (e.a === 10) c.panner.pan.setValueAtTime((e.b - 64) / 64, when);
        else if (e.a === 64) {
          c.sustain = e.b >= 64;
          if (!c.sustain) { for (const v of c.held) this.release(v, when); c.held = []; }
        } else if (e.a === 120 || e.a === 123) { for (const list of c.notes.values()) for (const v of list) this.release(v, when); c.notes.clear(); }
        break;
      default:
    }
  }
  noteOn(c, key, vel, when) {
    const ins = this.instrument(c.drum, c.drum ? 0 : c.bank, c.program);
    if (!ins) return;
    const rg = ins.regions.find((r) => key >= r.keyLo && key <= r.keyHi && vel >= r.velLo && vel <= r.velHi) ||
      ins.regions.find((r) => key >= r.keyLo && key <= r.keyHi);
    if (!rg) return;
    const ctx = this.ctx, w = this.bank.waves[rg.wave], env = rg.env;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer(rg.wave);
    if (rg.loop && rg.loop.length > 1) {
      src.loop = true;
      src.loopStart = rg.loop.start / w.rate;
      src.loopEnd = (rg.loop.start + rg.loop.length) / w.rate;
    }
    const cents = (c.drum ? 0 : (key - rg.unity) * 100) + rg.fine;
    src.playbackRate.setValueAtTime(2 ** ((cents + (c.drum ? 0 : c.bend * 100)) / 1200), when);
    const peak = (vel / 127) ** 2 * db(rg.gain - env.atten);
    const g = ctx.createGain();
    const attack = Math.max(0.002, env.attack);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    if (env.sustain < 0.999) g.gain.setTargetAtTime(peak * env.sustain, when + attack, Math.max(0.01, env.decay / 5));
    src.connect(g);
    if (env.pan) { const p = ctx.createStereoPanner(); p.pan.value = env.pan; g.connect(p); p.connect(c.gain); } else g.connect(c.gain);
    src.start(when);
    const v = { src, g, env, cents };
    if (!src.loop) src.stop(when + src.buffer.duration / Math.max(0.01, 2 ** (cents / 1200)) + 0.05);
    src.onended = () => { this.voices.delete(v); g.disconnect(); };
    this.voices.add(v);
    if (!c.drum) { const list = c.notes.get(key) || []; list.push(v); c.notes.set(key, list); }
    if (this.voices.size > 72) { const old = this.voices.values().next().value; this.release(old, when); this.voices.delete(old); }
  }
  noteOff(c, key, when) {
    if (c.drum) return; // drum kits play their samples out
    const list = c.notes.get(key);
    if (!list || !list.length) return;
    const v = list.shift();
    if (c.sustain) c.held.push(v); else this.release(v, when);
  }
  release(v, when) {
    if (v.released) return;
    v.released = true;
    const rel = Math.max(0.03, Math.min(4, v.env.release));
    const p = v.g.gain;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(when); else p.cancelScheduledValues(when);
    p.setTargetAtTime(0, when, rel / 5);
    try { v.src.stop(when + rel + 0.05); } catch { /* already stopped */ }
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.song = null;
    const now = this.ctx.currentTime;
    for (const v of this.voices) { try { v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0, now, 0.05); v.src.stop(now + 0.3); } catch { /* ignore */ } }
    this.voices.clear();
    if (this.channels) for (const c of this.channels) setTimeout(() => c.panner.disconnect(), 500);
    this.channels = null;
  }
}

// --------------------------------------------------------------- playlist
function readPref() { try { return localStorage.getItem('deche_music') !== '0'; } catch { return true; } }

export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.enabled = readPref();
    this.volume = 0.4;
    this.source = null;   // { names, track(name) -> Promise<ArrayBuffer>, bank() -> Promise<ArrayBuffer> }
    this.synth = null;
    this.mode = null;
    this.songs = new Map();
    this.playing = null;
  }
  // where the MIDI files and the wavetable bank come from (set by the asset loader)
  setSource(src) {
    if (src === this.source) return;
    this.source = src;
    this.halt();
    this.synth = null; this.bankP = null;
    if (this.mode) this.start(this.mode);
  }
  setEnabled(on) {
    this.enabled = !!on;
    try { localStorage.setItem('deche_music', on ? '1' : '0'); } catch { /* ignore */ }
    if (!on) this.halt(); else if (this.mode) this.start(this.mode);
  }
  setVolume(v) { this.volume = v; if (this.bus) this.bus.gain.value = v; }
  get available() { return !!(this.source && this.source.names.length && this.source.bank); }

  async ready() {
    const ctx = this.sfx.ensure();
    if (!ctx || !this.available) return null;
    if (!this.bankP) {
      this.bankP = this.source.bank().then((buf) => {
        const dls = parseDls(new Uint8Array(buf));
        this.bus = ctx.createGain(); this.bus.gain.value = this.volume;
        this.bus.connect(ctx.destination);
        // the GS synth's room reverb
        const rev = ctx.createConvolver(), wet = ctx.createGain(), dry = ctx.createGain();
        rev.buffer = impulse(ctx, 1.8);
        wet.gain.value = 0.22; dry.gain.value = 1;
        const mix = ctx.createGain();
        mix.connect(dry); dry.connect(this.bus);
        mix.connect(rev); rev.connect(wet); wet.connect(this.bus);
        this.synth = new MidiSynth(ctx, mix);
        this.synth.setBank(dls);
        return this.synth;
      }).catch((e) => { console.warn('music bank:', e); this.bankP = null; return null; });
    }
    return this.bankP;
  }
  song(name) {
    if (!this.songs.has(name)) this.songs.set(name, this.source.track(name).then((b) => parseMidi(new Uint8Array(b))).catch(() => null));
    return this.songs.get(name);
  }
  // mode: 'menu' (open.mid, looped), 'game' (music tracks one after another), 'won' / 'lost' (once)
  start(mode) {
    if (mode === this.mode && this.playing) return;
    this.mode = mode;
    this.halt();
    if (!this.enabled || !this.available) return;
    const names = this.source.names;
    let list;
    if (mode === 'menu') list = ['open.mid'];
    else if (mode === 'won' || mode === 'lost') list = [mode + '.mid'];
    else list = names.filter((n) => /^music\d+\.mid$/.test(n)).sort(() => Math.random() - 0.5);
    list = list.filter((n) => names.includes(n));
    if (!list.length) return;
    const token = {};
    this.playing = token;
    let i = 0;
    const next = async () => {
      if (this.playing !== token) return;
      const synth = await this.ready();
      const song = await this.song(list[i % list.length]);
      if (!synth || this.playing !== token) return;
      i++;
      if (!song) { if (i < list.length * 2) next(); return; }
      const once = mode === 'won' || mode === 'lost';
      synth.play(song, once ? null : next);
    };
    next();
  }
  halt() { this.playing = null; if (this.synth) this.synth.stop(); }
  stop() { this.mode = null; this.halt(); }
}

// decaying stereo noise: a cheap room impulse response
function impulse(ctx, sec) {
  const n = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  }
  return buf;
}
