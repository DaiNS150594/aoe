// Sound effects. When the player has loaded their own Rise of Rome files the
// original WAVs from sounds.drs are used (unit voices, the real priest
// "wololo", the under-attack horn...); otherwise everything is synthesised
// with WebAudio, so no audio files are needed.
import { aoe } from '../assets/loader.js';

// sfx name -> sound id in empires.dat (several ids = pick one at random)
const AOE_SOUNDS = {
  click: 39, chop: 137, mine: 130, build: 96, farm: 71, forage: 75, skin: 168,
  hit_sword: [26, 27, 28, 29], hit_club: 49, hit_villager: 121, hit_elephant: 65,
  shoot_arrow: 9, shoot_bolt: 13, shoot_stone: 44, shoot_pebble: 215, spear: 112, impact: 42,
  death: 52, animal_death: 83, collapse: 164, research: 162, alert: 10, chant: 159, heal: 160, tree: 100,
};
// ambient files of the game's sound/ folder per kind of land
const AMBIENT_KINDS = {
  grass: /^(grass|birds?)\d*\.wav$/, forest: /^(forest|birds?)\d*\.wav$/,
  desert: /^(desert|wind)\d*\.wav$/, water: /^(ocean|lake|stream)\d*\.wav$/,
};
export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.55;
    this.last = new Map();
    this.noiseBuf = null;
  }
  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return null; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  throttle(name, ms) {
    const now = performance.now();
    const l = this.last.get(name) || 0;
    if (now - l < ms) return false;
    this.last.set(name, now);
    return true;
  }

  tone(freq, dur, type = 'sine', vol = 0.3, t0 = 0, slideTo = null, dest = null) {
    const c = this.ctx, t = c.currentTime + t0;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  noise(dur, filterType, freq, q, vol, t0 = 0, freqTo = null) {
    const c = this.ctx, t = c.currentTime + t0;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = filterType; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  play(name, vol = 1, opts = null) {
    if (!this.enabled) return;
    const c = this.ensure();
    if (!c) return;
    const minGap = { chop: 140, mine: 160, build: 160, hit_sword: 70, hit_club: 80, shoot_arrow: 60, death: 90, chant: 1600 }[name] || 50;
    if (!this.throttle(name, minGap)) return;
    const v = vol;
    if (this.playAoe(name, v, opts)) return;
    switch (name) {
      case 'click': this.tone(1400, 0.04, 'square', 0.06 * v); break;
      case 'select': this.tone(520, 0.06, 'triangle', 0.12 * v); this.tone(780, 0.05, 'triangle', 0.08 * v, 0.05); break;
      case 'select_mil': this.tone(330, 0.07, 'sawtooth', 0.07 * v); this.tone(440, 0.06, 'triangle', 0.08 * v, 0.06); break;
      case 'select_bld': this.noise(0.12, 'lowpass', 600, 1, 0.18 * v); break;
      case 'move': this.tone(400, 0.06, 'triangle', 0.1 * v); this.tone(300, 0.07, 'triangle', 0.08 * v, 0.05); break;
      case 'attack_order': this.tone(240, 0.08, 'sawtooth', 0.08 * v); this.tone(360, 0.08, 'sawtooth', 0.07 * v, 0.07); break;
      case 'chop': this.noise(0.06, 'bandpass', 900, 4, 0.35 * v); this.tone(180, 0.05, 'sine', 0.15 * v); break;
      case 'mine': this.tone(2200, 0.08, 'triangle', 0.08 * v); this.tone(3300, 0.06, 'sine', 0.05 * v); this.noise(0.04, 'highpass', 3000, 1, 0.1 * v); break;
      case 'build': this.noise(0.05, 'bandpass', 500, 3, 0.3 * v); this.tone(140, 0.06, 'sine', 0.18 * v); break;
      case 'hit_sword': this.noise(0.09, 'bandpass', 2600 + Math.random() * 800, 9, 0.3 * v); this.tone(1800 + Math.random() * 400, 0.12, 'triangle', 0.05 * v); break;
      case 'hit_club': case 'hit_villager': this.noise(0.08, 'lowpass', 500, 1, 0.35 * v); break;
      case 'hit_elephant': this.noise(0.18, 'lowpass', 300, 1, 0.4 * v); this.tone(90, 0.2, 'sine', 0.2 * v); break;
      case 'shoot_arrow': case 'shoot_pebble': this.noise(0.18, 'bandpass', 2400, 2, 0.12 * v, 0, 700); break;
      case 'shoot_bolt': this.noise(0.22, 'bandpass', 1400, 2, 0.2 * v, 0, 400); this.tone(160, 0.08, 'square', 0.06 * v); break;
      case 'shoot_stone': this.noise(0.25, 'lowpass', 400, 1, 0.3 * v); this.tone(110, 0.2, 'sawtooth', 0.08 * v, 0, 60); break;
      case 'shoot_rocket': this.noise(0.4, 'bandpass', 900, 1, 0.25 * v, 0, 2400); break;
      case 'shoot_laser': this.tone(1800, 0.18, 'sawtooth', 0.07 * v, 0, 400); break;
      case 'impact': this.noise(0.35, 'lowpass', 220, 1, 0.45 * v); break;
      case 'spear': this.noise(0.12, 'bandpass', 1500, 2, 0.12 * v, 0, 500); break;
      case 'death': this.tone(150 + Math.random() * 40, 0.25, 'sawtooth', 0.08 * v, 0, 70); this.noise(0.12, 'lowpass', 700, 1, 0.1 * v); break;
      case 'animal_death': this.tone(420, 0.2, 'triangle', 0.06 * v, 0, 160); break;
      case 'collapse': this.noise(1.3, 'lowpass', 260, 0.7, 0.55 * v, 0, 60); this.noise(0.5, 'bandpass', 900, 1, 0.18 * v, 0.1); break;
      case 'built': [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12 * v, i * 0.09)); break;
      case 'trained': this.tone(660, 0.07, 'triangle', 0.08 * v); this.tone(880, 0.1, 'triangle', 0.07 * v, 0.06); break;
      case 'research': [784, 988, 1175].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.09 * v, i * 0.08)); break;
      case 'ageup': {
        const notes = [392, 523, 659, 784, 1046];
        notes.forEach((f, i) => { this.tone(f, 0.32, 'triangle', 0.14 * v, i * 0.14); this.tone(f / 2, 0.32, 'sawtooth', 0.04 * v, i * 0.14); });
        this.tone(784, 0.9, 'triangle', 0.12 * v, 0.7); this.tone(1046, 0.9, 'triangle', 0.1 * v, 0.7);
        break;
      }
      case 'error': this.tone(140, 0.12, 'square', 0.08 * v); this.tone(110, 0.14, 'square', 0.08 * v, 0.1); break;
      case 'needhouse': this.tone(330, 0.12, 'triangle', 0.1 * v); this.tone(247, 0.18, 'triangle', 0.1 * v, 0.12); break;
      case 'alert': {
        // war horn
        for (const [f, t0, d] of [[220, 0, 0.35], [294, 0.32, 0.55]]) {
          const o = this.tone(f, d, 'sawtooth', 0.12 * v, t0);
          const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
          lfo.frequency.value = 6; lg.gain.value = 4; lfo.connect(lg); lg.connect(o.frequency);
          lfo.start(this.ctx.currentTime + t0); lfo.stop(this.ctx.currentTime + t0 + d);
        }
        break;
      }
      case 'chant': this.wololo(v); break;
      case 'converted': [659, 523, 659].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.1 * v, i * 0.1)); break;
      case 'chat': this.tone(1046, 0.08, 'sine', 0.08 * v); this.tone(1318, 0.1, 'sine', 0.06 * v, 0.07); break;
      case 'victory': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.14 * v, i * 0.2)); break;
      case 'defeat': [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.12 * v, i * 0.3)); break;
      case 'tree': this.noise(0.5, 'lowpass', 700, 1, 0.25 * v, 0, 150); break;
    }
  }

  // original sound from sounds.drs; false when not available
  playAoe(name, v, opts) {
    const A = aoe();
    if (!A || !A.assets.sounds) return false;
    let sid = opts && opts.sound !== undefined ? opts.sound : AOE_SOUNDS[name];
    if (Array.isArray(sid)) sid = sid[(Math.random() * sid.length) | 0];
    if (sid === undefined || sid < 0) return false;
    const res = A.assets.pickSound(sid);
    if (res < 0) return false;
    this.playBuffer(A.assets.audioBuffer(this.ctx, res), v);
    return true;
  }
  playBuffer(promise, v) {
    const c = this.ctx;
    promise.then((buf) => {
      if (!buf || !this.enabled) return;
      const src = c.createBufferSource(); src.buffer = buf;
      const g = c.createGain(); g.gain.value = Math.min(1.5, v);
      src.connect(g); g.connect(this.master); src.start();
    });
  }
  // unit / building specific sound (selection voice, command, trained...)
  entity(kind, e, world) {
    const fb = { select: !e ? 'select' : e.kind === 'building' ? 'select_bld' : e.type === 'villager' ? 'select' : 'select_mil', move: 'move', attack: 'attack_order', train: 'trained', built: 'built' }[kind] || kind;
    const A = aoe();
    if (A && e && world) {
      const p = world.players[e.owner];
      const civ = p && !p.isGaia ? p.civId : null;
      let def = null;
      if (e.kind === 'building') { const b = A.mapping.building(civ, e.type, p ? p.age : 0); def = b && b.unit; }
      else def = (e.type === 'villager' && e.task && A.mapping.taskDef(civ, e.task)) || A.mapping.unitDef(civ, e.type);
      const sid = def ? { select: def.selectionSound, move: def.commandSound, attack: def.commandSound, train: def.trainSound, built: def.selectionSound }[kind] : undefined;
      if (sid !== undefined && sid >= 0) { this.play(fb, 1, { sound: sid }); return; }
    }
    this.play(fb);
  }
  // ambient sound of the original game (sound/*.wav) for a kind of land:
  // 'grass', 'forest', 'desert' or 'water'
  ambient(kind, v = 0.3) {
    const A = aoe();
    const amb = A && A.assets.ambient;
    if (!amb || !this.enabled || !this.ensure()) return false;
    const names = amb.names.filter((n) => AMBIENT_KINDS[kind].test(n));
    if (!names.length) return false;
    const name = names[(Math.random() * names.length) | 0];
    if (!this.ambientBufs) this.ambientBufs = new Map();
    let p = this.ambientBufs.get(name);
    if (!p) { p = amb.load(name).then((b) => this.ctx.decodeAudioData(b)).catch(() => null); this.ambientBufs.set(name, p); }
    this.playBuffer(p, v);
    return true;
  }
  // chat taunts (sound/tauntNNN.wav of the player's game folder)
  taunt(n) {
    const A = aoe();
    if (!A || !this.enabled || !A.assets.taunts.has(n) || !this.ensure()) return false;
    if (!this.throttle('taunt', 400)) return true;
    this.playBuffer(A.assets.tauntBuffer(this.ctx, n), 1);
    return true;
  }

  // "Wo-lo-lo": spoken by the browser's speech synthesiser when available
  // (sounds like the real chant), otherwise a vibrato chant through formants.
  wololo(v = 1) {
    if (this.voice !== false && typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
      try {
        const u = new SpeechSynthesisUtterance('wo lo lo');
        u.lang = 'en-US'; u.pitch = 0.35; u.rate = 0.55; u.volume = Math.min(1, this.volume * 1.4 * v);
        const voices = speechSynthesis.getVoices();
        const male = voices.find((x) => /en/i.test(x.lang) && /(David|Mark|Guy|male)/i.test(x.name)) || voices.find((x) => /en/i.test(x.lang));
        if (male) u.voice = male;
        speechSynthesis.speak(u);
        return;
      } catch { /* fall back to the synthesised chant */ }
    }
    const c = this.ctx;
    const syl = [[196, 0.34, 600], [175, 0.24, 520], [196, 0.42, 480]];
    let t0 = 0;
    for (const [f, d, formant] of syl) {
      const t = c.currentTime + t0;
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t);
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 5.5; lg.gain.value = 5; lfo.connect(lg); lg.connect(o.frequency);
      const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = formant; f1.Q.value = 5;
      const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = formant * 1.6; f2.Q.value = 6;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.05); g.gain.setValueAtTime(0.5 * v, t + d * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + d + 0.05); lfo.start(t); lfo.stop(t + d + 0.05);
      t0 += d * 0.95;
    }
  }
}
