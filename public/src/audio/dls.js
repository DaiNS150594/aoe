// Reader for Downloadable Sounds level 1 banks — gm.dls is the "Microsoft GS
// Wavetable Synth" bank that Age of Empires' MIDI music played through on
// Windows. Returns instruments (bank, program, drum kit flag, key/velocity
// regions with their wave, root key, tuning, loop and envelope) and the
// sample pool as Float32 PCM.

const CONN = { // DLS level 1 connection destinations
  ATTENUATION: 0x0001, PAN: 0x0004, EG1_ATTACK: 0x0206, EG1_DECAY: 0x0207, EG1_RELEASE: 0x0209, EG1_SUSTAIN: 0x020a,
};

export function parseDls(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'DLS ') throw new Error('not a DLS bank');

  // calls fn(id, listType, dataStart, dataEnd) for each chunk of [start, end)
  const walk = (start, end, fn) => {
    let o = start;
    while (o + 8 <= end) {
      const id = tag(o), size = dv.getUint32(o + 4, true);
      const data = o + 8, stop = Math.min(end, data + size);
      if (id === 'LIST' || id === 'RIFF') fn(id, tag(data), data + 4, stop);
      else fn(id, null, data, stop);
      o = data + size + (size & 1);
    }
  };

  const instruments = [], waves = [], waveAt = new Map();
  let cues = [];
  const readArt = (start, end, art) => {
    walk(start, end, (id, type, s) => {
      if (id !== 'art1') return;
      const n = dv.getUint32(s + 4, true);
      let o = s + dv.getUint32(s, true);
      for (let i = 0; i < n; i++, o += 12) {
        const src = dv.getUint16(o, true), ctl = dv.getUint16(o + 2, true), dst = dv.getUint16(o + 4, true);
        const scale = dv.getInt32(o + 8, true);
        if (src !== 0 || ctl !== 0) continue; // only the fixed (unmodulated) values
        const tc = (v) => (v === -2147483648 ? 0 : 2 ** (v / 65536 / 1200)); // time cents -> s
        if (dst === CONN.EG1_ATTACK) art.attack = tc(scale);
        else if (dst === CONN.EG1_DECAY) art.decay = tc(scale);
        else if (dst === CONN.EG1_RELEASE) art.release = tc(scale);
        else if (dst === CONN.EG1_SUSTAIN) art.sustain = Math.max(0, Math.min(1, scale / 65536 / 1000));
        else if (dst === CONN.PAN) art.pan = Math.max(-1, Math.min(1, scale / 65536 / 500));
        else if (dst === CONN.ATTENUATION) art.atten = scale / 65536 / 10; // dB
      }
    });
    return art;
  };
  const readWsmp = (s) => {
    const n = dv.getUint32(s + 16, true);
    const w = { unity: dv.getUint16(s + 4, true), fine: dv.getInt16(s + 6, true), gain: dv.getInt32(s + 8, true) / 655360, loop: null };
    if (n > 0) {
      const lo = s + dv.getUint32(s, true);
      w.loop = { start: dv.getUint32(lo + 8, true), length: dv.getUint32(lo + 12, true) };
    }
    return w;
  };

  walk(12, b.length, (id, type, s, e) => {
    if (id === 'ptbl') {
      const n = dv.getUint32(s + 4, true), o = s + dv.getUint32(s, true);
      cues = Array.from({ length: n }, (_, i) => dv.getUint32(o + i * 4, true));
    } else if (id === 'LIST' && type === 'wvpl') {
      walk(s, e, (wid, wtype, ws, we) => {
        if (wid !== 'LIST' || wtype !== 'wave') return;
        const wave = { rate: 22050, data: null, wsmp: null };
        walk(ws, we, (cid, _t, cs, ce) => {
          if (cid === 'fmt ') { wave.channels = dv.getUint16(cs + 2, true); wave.rate = dv.getUint32(cs + 4, true); wave.bits = dv.getUint16(cs + 14, true); }
          else if (cid === 'data') wave.raw = [cs, ce];
          else if (cid === 'wsmp') wave.wsmp = readWsmp(cs);
        });
        if (!wave.raw) return;
        const [cs, ce] = wave.raw, step = (wave.bits === 8 ? 1 : 2) * (wave.channels || 1);
        const n = Math.floor((ce - cs) / step);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = wave.bits === 8 ? (b[cs + i * step] - 128) / 128 : dv.getInt16(cs + i * step, true) / 32768;
        delete wave.raw;
        wave.data = out;
        waveAt.set(ws - 12 - s, waves.length); // offset of the 'LIST' header from the pool data
        waves.push(wave);
      });
    } else if (id === 'LIST' && type === 'lins') {
      walk(s, e, (iid, itype, is, ie) => {
        if (iid !== 'LIST' || itype !== 'ins ') return;
        const ins = { bank: 0, program: 0, drum: false, regions: [], art: {} };
        walk(is, ie, (cid, ctype, cs, ce) => {
          if (cid === 'insh') {
            const bank = dv.getUint32(cs + 4, true);
            ins.drum = (bank & 0x80000000) !== 0;
            ins.bank = (bank >> 8) & 0x7f; // bank select MSB
            ins.program = dv.getUint32(cs + 8, true) & 0x7f;
          } else if (cid === 'LIST' && ctype === 'lart') readArt(cs, ce, ins.art);
          else if (cid === 'LIST' && ctype === 'lrgn') {
            walk(cs, ce, (rid, rtype, rs, re) => {
              if (rid !== 'LIST' || (rtype !== 'rgn ' && rtype !== 'rgn2')) return;
              const rg = { keyLo: 0, keyHi: 127, velLo: 0, velHi: 127, cue: 0, wsmp: null, art: null };
              walk(rs, re, (kid, ktype, ks, ke) => {
                if (kid === 'rgnh') { rg.keyLo = dv.getUint16(ks, true); rg.keyHi = dv.getUint16(ks + 2, true); rg.velLo = dv.getUint16(ks + 4, true); rg.velHi = dv.getUint16(ks + 6, true); }
                else if (kid === 'wsmp') rg.wsmp = readWsmp(ks);
                else if (kid === 'wlnk') rg.cue = dv.getUint32(ks + 8, true);
                else if (kid === 'LIST' && ktype === 'lart') rg.art = readArt(ks, ke, {});
              });
              ins.regions.push(rg);
            });
          }
        });
        instruments.push(ins);
      });
    }
  });
  // regions -> wave index (the pool table holds offsets into the wave pool)
  for (const ins of instruments) {
    for (const rg of ins.regions) {
      const off = cues[rg.cue];
      rg.wave = waveAt.has(off) ? waveAt.get(off) : rg.cue < waves.length ? rg.cue : 0;
      const ws = rg.wsmp || waves[rg.wave].wsmp || { unity: 60, fine: 0, gain: 0, loop: null };
      rg.unity = ws.unity; rg.fine = ws.fine; rg.gain = ws.gain; rg.loop = ws.loop;
      rg.env = { attack: 0, decay: 0, sustain: 1, release: 0.15, pan: 0, atten: 0, ...ins.art, ...(rg.art || {}) };
      delete rg.wsmp; delete rg.art;
    }
  }
  return { instruments, waves };
}
