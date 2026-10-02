// Fully synthesised audio -- no sample files, nothing licensed, all WebAudio.
//
// Engine: three detuned oscillators tracking rpm through a resonant filter,
// plus intake and exhaust noise beds that open with throttle. Tyres, surface
// roar, bumps, horns, birds, wind, market babble and rain are all generated.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.master = null;
    this.volume = 0.75;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.noiseBuf = this._noiseBuffer(2.0);

    // ---------------- engine ------------------------------------------
    this.eng = {};
    const eg = ctx.createGain();
    eg.gain.value = 0;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 900;
    engFilter.Q.value = 1.3;
    const engPeak = ctx.createBiquadFilter();
    engPeak.type = 'peaking';
    engPeak.frequency.value = 220;
    engPeak.Q.value = 2.2;
    engPeak.gain.value = 9;
    eg.connect(engFilter);
    engFilter.connect(engPeak);
    engPeak.connect(this.master);
    this.eng.gain = eg;
    this.eng.filter = engFilter;

    this.eng.oscs = [];
    for (const [type, mul, lvl, det] of [
      ['sawtooth', 1.0, 0.5, 0],
      ['square', 0.5, 0.22, -6],
      ['sawtooth', 2.0, 0.13, 9],
      ['triangle', 0.25, 0.3, 3],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 40;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = lvl;
      o.connect(g);
      g.connect(eg);
      o.start();
      this.eng.oscs.push({ o, mul, g });
    }
    // exhaust noise
    const exh = ctx.createBufferSource();
    exh.buffer = this.noiseBuf;
    exh.loop = true;
    const exhF = ctx.createBiquadFilter();
    exhF.type = 'bandpass';
    exhF.frequency.value = 280;
    exhF.Q.value = 1.1;
    const exhG = ctx.createGain();
    exhG.gain.value = 0;
    exh.connect(exhF);
    exhF.connect(exhG);
    exhG.connect(this.master);
    exh.start();
    this.eng.exhG = exhG;
    this.eng.exhF = exhF;

    // ---------------- tyres / surface ---------------------------------
    const tyre = ctx.createBufferSource();
    tyre.buffer = this.noiseBuf;
    tyre.loop = true;
    const tyreF = ctx.createBiquadFilter();
    tyreF.type = 'bandpass';
    tyreF.frequency.value = 1200;
    tyreF.Q.value = 0.7;
    const tyreG = ctx.createGain();
    tyreG.gain.value = 0;
    tyre.connect(tyreF);
    tyreF.connect(tyreG);
    tyreG.connect(this.master);
    tyre.start();
    this.tyre = { g: tyreG, f: tyreF };

    // ---------------- wind ---------------------------------------------
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const windF = ctx.createBiquadFilter();
    windF.type = 'lowpass';
    windF.frequency.value = 500;
    const windG = ctx.createGain();
    windG.gain.value = 0;
    wind.connect(windF);
    windF.connect(windG);
    windG.connect(this.master);
    wind.start();
    this.wind = { g: windG, f: windF };

    // ---------------- ambience beds ------------------------------------
    this.ambBirds = this._bed(0, 'bandpass', 2600, 1.2);
    this.ambMarket = this._bed(0, 'bandpass', 700, 0.6);
    this.ambRain = this._bed(0, 'highpass', 900, 0.4);
    this.ambNight = this._bed(0, 'bandpass', 4200, 6);

    this.enabled = true;
    this._birdTimer = 0;
    this._lastHorn = 0;
  }

  _bed(level, type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
    return { g, f };
  }

  _noiseBuffer(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = 0.96 * last + 0.04 * white;
      d[i] = white * 0.6 + last * 0.8;
    }
    return buf;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  mute(on) {
    if (this.master) this.master.gain.value = on ? 0 : this.volume;
  }

  /** Per-frame engine + environment update. */
  update(dt, bike, env) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = bike.rpm;
    const base = (rpm / 60) * 0.5; // 4-stroke single fires every other rev
    for (const { o, mul } of this.eng.oscs) {
      o.frequency.setTargetAtTime(Math.max(12, base * mul), t, 0.04);
    }
    const load = bike.throttle;
    const spd = Math.abs(bike.speed);
    const engLevel = (bike.engineOn ? 0.052 + load * 0.1 + Math.min(0.06, rpm / 9000 * 0.08) : 0);
    this.eng.gain.gain.setTargetAtTime(engLevel, t, 0.05);
    this.eng.filter.frequency.setTargetAtTime(500 + load * 2600 + rpm * 0.13, t, 0.06);
    this.eng.exhG.gain.setTargetAtTime((0.012 + load * 0.055) * (bike.engineOn ? 1 : 0), t, 0.05);
    this.eng.exhF.frequency.setTargetAtTime(160 + rpm * 0.055, t, 0.08);

    const rough = bike.roughness;
    this.tyre.g.gain.setTargetAtTime(Math.min(0.1, spd * 0.0032 * (0.6 + rough)), t, 0.1);
    this.tyre.f.frequency.setTargetAtTime(600 + spd * 42 + rough * 700, t, 0.12);

    this.wind.g.gain.setTargetAtTime(Math.min(0.09, Math.max(0, (spd - 6) * 0.0048)), t, 0.2);
    this.wind.f.frequency.setTargetAtTime(300 + spd * 26, t, 0.2);

    // ambience
    const night = env.hour < 6 || env.hour > 19.3;
    const dawnChorus = env.hour > 5.4 && env.hour < 9.2;
    this.ambBirds.g.gain.setTargetAtTime(dawnChorus && !env.rain ? 0.016 * (1 - env.urban * 0.4) : 0.003, t, 1.5);
    this.ambMarket.g.gain.setTargetAtTime(env.urban * (night ? 0.004 : 0.016) * env.crowd, t, 1.2);
    this.ambRain.g.gain.setTargetAtTime(env.rain * 0.09, t, 1.0);
    this.ambNight.g.gain.setTargetAtTime(night ? 0.006 : 0, t, 2.0);

    if (bike.bumpEvent > 0.02) this.bump(bike.bumpEvent);

    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      this._birdTimer = 2 + Math.random() * 9;
      if (dawnChorus && Math.random() < 0.6 && env.urban < 0.8) this.birdCall();
      else if (night && Math.random() < 0.25) this.insect();
    }
  }

  bump(strength) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110 + Math.random() * 50, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(Math.min(0.28, strength * 0.4), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.25);

    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 420;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(strength * 0.16, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(this.master);
    n.start(t);
    n.stop(t + 0.16);
  }

  /** Indian road horn: a two-tone blare. */
  horn(kind = 'bike', distance = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - this._lastHorn < 0.12) return;
    this._lastHorn = t;
    const atten = Math.max(0.05, 1 - distance / 60);
    const profiles = {
      bike: [[520, 760], 0.35, 0.10],
      scooter: [[600, 840], 0.3, 0.08],
      auto: [[420, 640], 0.4, 0.12],
      car: [[380, 500], 0.5, 0.13],
      bus: [[210, 290], 0.8, 0.18],
      truck: [[180, 250], 0.9, 0.2],
      tractor: [[260, 330], 0.5, 0.1],
      cycle: [[1400, 1700], 0.25, 0.05],
      player: [[540, 790], 0.45, 0.16],
    };
    const [freqs, dur, vol] = profiles[kind] || profiles.bike;
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = f * 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol * atten, t + 0.015);
      g.gain.setValueAtTime(vol * atten, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(flt);
      flt.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  birdCall() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const st = t + i * (0.09 + Math.random() * 0.08);
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f0 = 2200 + Math.random() * 1800;
      o.frequency.setValueAtTime(f0, st);
      o.frequency.exponentialRampToValueAtTime(f0 * (0.6 + Math.random() * 0.8), st + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.028, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.09);
      o.connect(g);
      g.connect(this.master);
      o.start(st);
      o.stop(st + 0.12);
    }
  }

  insect() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 3800 + Math.random() * 900;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lg = ctx.createGain();
    lg.gain.value = 0.006;
    lfo.connect(lg);
    lg.connect(g.gain);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 4200;
    o.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start(t);
    lfo.start(t);
    const dur = 1.2 + Math.random() * 2;
    g.gain.setValueAtTime(0.004, t + dur);
    g.gain.exponentialRampToValueAtTime(0.00001, t + dur + 0.3);
    o.stop(t + dur + 0.4);
    lfo.stop(t + dur + 0.4);
  }

  blip(freq = 660, dur = 0.08, vol = 0.12) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
