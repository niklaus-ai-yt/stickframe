// Audio: procedural sound effects, generative background music and the final mix.
// Everything is synthesised here unless a project points at a sound library of samples (see loadSfxLibrary).
import fs from 'node:fs';
import path from 'node:path';
import { decodePcm, writeWav } from './media.js';

export const RATE = 44100;
const TAU = Math.PI * 2;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const buf = (sec) => new Float32Array(Math.max(1, Math.round(sec * RATE)));
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));

// One-pole filters, used in place by the generators.
function lowpass(x, cutoff) {
  const k = 1 - Math.exp((-TAU * cutoff) / RATE);
  let y = 0;
  for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] = y; }
  return x;
}
function highpass(x, cutoff) {
  const k = 1 - Math.exp((-TAU * cutoff) / RATE);
  let y = 0;
  for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] -= y; }
  return x;
}

function tone(sec, f0, f1, { type = 'sine', a = 0.005, d = 0.2, vol = 1 } = {}) {
  const x = buf(sec);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    const f = f0 * Math.pow(f1 / f0, t / sec);
    ph += f / RATE;
    const p = ph % 1;
    const s = type === 'square' ? (p < 0.5 ? 1 : -1) : type === 'saw' ? 2 * p - 1 : type === 'tri' ? 1 - 4 * Math.abs(p - 0.5) : Math.sin(p * TAU);
    x[i] = s * env(t, a, d) * vol;
  }
  return x;
}

function noise(sec, { a = 0.005, d = 0.2, vol = 1, seed = 1 } = {}) {
  const r = rng(seed), x = buf(sec);
  for (let i = 0; i < x.length; i++) x[i] = (r() * 2 - 1) * env(i / RATE, a, d) * vol;
  return x;
}

function add(dst, src, at = 0, vol = 1) {
  const o = Math.round(at * RATE);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * vol;
  return dst;
}

function sweepNoise(sec, f0, f1, seed, shape) {
  const r = rng(seed), x = buf(sec);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / sec / RATE;
    const f = f0 * Math.pow(f1 / f0, t);
    const k = 1 - Math.exp((-TAU * f) / RATE);
    y += k * ((r() * 2 - 1) - y);
    x[i] = y * shape(t);
  }
  return x;
}

const SFX = {
  whoosh: () => { const x = sweepNoise(0.5, 300, 4000, 3, (t) => Math.sin(Math.PI * t) ** 2); return highpass(x, 200).map((v) => v * 2.2); },
  swoosh: () => sweepNoise(0.9, 2500, 300, 4, (t) => Math.sin(Math.PI * t) ** 1.5).map((v) => v * 2),
  pop: () => tone(0.14, 900, 300, { d: 0.04, vol: 0.8 }),
  ding: () => { const x = buf(1.4); [1, 2.76, 5.4].forEach((m, i) => add(x, tone(1.4, 1320 * m, 1320 * m, { d: 0.5 / (i + 1), vol: 0.4 / (i + 1) }))); return x; },
  boom: () => { const x = tone(1.6, 90, 30, { d: 0.5, vol: 1 }); add(x, lowpass(noise(1.2, { d: 0.3, vol: 0.7, seed: 9 }), 400)); return x; },
  thud: () => { const x = tone(0.35, 120, 50, { d: 0.08, vol: 1 }); add(x, lowpass(noise(0.2, { d: 0.04, vol: 0.6, seed: 2 }), 900)); return x; },
  punch: () => { const x = tone(0.3, 160, 60, { d: 0.06, vol: 1 }); add(x, highpass(noise(0.1, { d: 0.02, vol: 0.9, seed: 5 }), 1500)); return x; },
  click: () => highpass(noise(0.03, { a: 0.0005, d: 0.006, vol: 1, seed: 7 }), 2000),
  tick: () => { const x = highpass(noise(0.05, { a: 0.0005, d: 0.008, vol: 0.9, seed: 8 }), 3000); add(x, tone(0.05, 2400, 2400, { d: 0.01, vol: 0.3 })); return x; },
  riser: () => { const x = sweepNoise(2.2, 200, 6000, 6, (t) => t ** 2); add(x, tone(2.2, 110, 880, { type: 'saw', a: 2, d: 0.05, vol: 0.12 })); return lowpass(x, 6000); },
  heartbeat: () => { const x = buf(1.0); add(x, tone(0.18, 70, 45, { d: 0.06, vol: 1 }), 0); add(x, tone(0.18, 65, 40, { d: 0.06, vol: 0.7 }), 0.22); return lowpass(x, 300); },
  cash: () => { const x = buf(1.2); add(x, highpass(noise(0.08, { d: 0.02, vol: 0.8, seed: 3 }), 2000)); [2093, 2637, 3136].forEach((f, i) => add(x, tone(1.0, f, f, { d: 0.35, vol: 0.25 }), 0.05 + i * 0.02)); return x; },
  glitch: () => { const r = rng(12), x = buf(0.45); for (let i = 0; i < x.length; i++) { const blk = Math.floor(i / 600); x[i] = (Math.floor(r() * 3) - 1) * (blk % 3 ? 0.5 : 0) + Math.sin(i * (0.05 + (blk % 5) * 0.03)) * 0.3; } return x; },
  sparkle: () => { const x = buf(1.3); [2093, 2637, 3136, 4186, 3520, 5274].forEach((f, i) => add(x, tone(0.5, f, f, { d: 0.15, vol: 0.18 }), i * 0.07)); return x; },
  freeze: () => { const x = sweepNoise(1.4, 6000, 1500, 13, (t) => (1 - t) * 0.5); [1568, 2093, 3136].forEach((f) => add(x, tone(1.4, f * 1.02, f, { d: 0.5, vol: 0.12 }))); return x; },
  splash: () => lowpass(noise(0.8, { a: 0.005, d: 0.18, vol: 1.2, seed: 21 }), 2500),
  step: () => lowpass(noise(0.12, { a: 0.001, d: 0.03, vol: 1, seed: 31 }), 700),
  typing: () => { const x = buf(1.0); const r = rng(4); for (let i = 0; i < 9; i++) add(x, highpass(noise(0.03, { a: 0.0005, d: 0.008, vol: 0.7, seed: i + 40 }), 1500), i * 0.09 + r() * 0.04); return x; },
  alarm: () => { const x = buf(1.2); for (let i = 0; i < 4; i++) add(x, tone(0.14, 1760, 1760, { type: 'square', a: 0.002, d: 1, vol: 0.18 }), i * 0.28); return lowpass(x, 5000); },
  buzz: () => lowpass(tone(0.6, 110, 100, { type: 'saw', a: 0.01, d: 0.5, vol: 0.45 }), 1800),
  success: () => { const x = buf(1.2); [523, 659, 784, 1047].forEach((f, i) => add(x, tone(0.6, f, f, { type: 'tri', d: 0.25, vol: 0.35 }), i * 0.09)); return x; },
  fail: () => { const x = buf(1.6); [392, 370, 349, 311].forEach((f, i) => add(x, lowpass(tone(i === 3 ? 0.8 : 0.35, f, f * (i === 3 ? 0.94 : 1), { type: 'saw', a: 0.02, d: 0.4, vol: 0.25 }), 1400), i * 0.3)); return x; },
  shutter: () => { const x = highpass(noise(0.06, { a: 0.0005, d: 0.01, vol: 1, seed: 50 }), 1200); add(x, highpass(noise(0.06, { a: 0.0005, d: 0.012, vol: 0.8, seed: 51 }), 1200), 0.07); return x; },
  laugh: () => { const x = buf(1.0); for (let i = 0; i < 5; i++) add(x, tone(0.12, 520 - i * 25, 440 - i * 25, { type: 'tri', a: 0.01, d: 0.05, vol: 0.3 }), i * 0.14); return x; },
  crowd: () => { const r = rng(77), x = buf(2.5); let y = 0, m = 0; for (let i = 0; i < x.length; i++) { const t = i / x.length; y += 0.08 * ((r() * 2 - 1) - y); m += 0.0005 * ((r() * 2 - 1) - m); x[i] = y * (0.6 + m * 8) * Math.sin(Math.PI * Math.min(1, t * 1.6)) * 1.4; } return lowpass(x, 3000); },
  thunder: () => { const x = lowpass(noise(3, { a: 0.02, d: 0.9, vol: 1.4, seed: 61 }), 260); add(x, highpass(noise(0.3, { d: 0.06, vol: 0.4, seed: 62 }), 800)); return x; },
  phone: () => { const x = buf(1.0); for (let i = 0; i < 2; i++) add(x, tone(0.3, 180, 180, { type: 'square', a: 0.01, d: 1, vol: 0.16 }), i * 0.42); return lowpass(x, 800); },
  door: () => { const x = buf(0.9); for (let i = 0; i < 3; i++) add(x, lowpass(tone(0.12, 180, 90, { d: 0.03, vol: 0.9 }), 900), i * 0.2); return x; },
};
export const SFX_NAMES = Object.keys(SFX);
function peakTo(x, level = 0.9) {
  let pk = 0;
  for (const v of x) pk = Math.max(pk, Math.abs(v));
  if (pk > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i] / pk) * level;
  return x;
}
const sfxCache = new Map();
export function sfxBuffer(name) {
  if (!SFX[name]) return null;
  if (!sfxCache.has(name)) sfxCache.set(name, peakTo(SFX[name]()));
  return sfxCache.get(name);
}

// ---------------- sound library ----------------
// A folder with library.json: {"version":1,"sounds":{"<ID>":{"file":"a.wav","gain_db":0,"description":"..."}}}.
// Picked per project ("sfxLibrary": the folder or the json file) or with STICKFRAME_SFX_LIBRARY.
// Storyboard sfx whose "sound" is a library ID play that sample; anything else uses the synthesised set.
const libCache = new Map(), libWarned = new Set();
const warnOnce = (key, msg) => { if (!libWarned.has(key)) { libWarned.add(key); console.warn(msg); } };
export function loadSfxLibrary(where) {
  if (where && typeof where === 'object') return where;
  where = String(where || process.env.STICKFRAME_SFX_LIBRARY || '').trim();
  if (!where) return null;
  let file = path.resolve(where);
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'library.json');
    const mtime = fs.statSync(file).mtimeMs, hit = libCache.get(file);
    if (hit && hit.mtime === mtime) return hit.lib;
    const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const dir = path.dirname(file), sounds = {};
    for (const [id, x] of Object.entries(j?.sounds || {})) if (x && x.file) sounds[id] = { ...x, file: path.resolve(dir, String(x.file)), gain_db: Number(x.gain_db) || 0 };
    const lib = { file, dir, sounds, ids: Object.keys(sounds) };
    libCache.set(file, { mtime, lib });
    return lib;
  } catch (e) {
    warnOnce(file, `Sound library ${file} could not be read (${e.message}); using the built-in sounds.`);
    return null;
  }
}
// Decoded once per process (per file version), mono at the mix rate, peak-normalised like the synth sounds.
const sampleCache = new Map();
export function sampleBuffer(lib, id) {
  const s = lib?.sounds?.[id];
  if (!s) return Promise.resolve(null);
  let key;
  try { const st = fs.statSync(s.file); key = `${s.file}|${st.mtimeMs}|${st.size}`; } catch { warnOnce(s.file, `Sound "${id}" is missing its file ${s.file}`); return Promise.resolve(null); }
  if (!sampleCache.has(key)) sampleCache.set(key, decodePcm(s.file, RATE).then((x) => (x.length ? peakTo(x) : null)).catch((e) => { warnOnce(key, `Sound "${id}" could not be decoded: ${e.message}`); return null; }));
  return sampleCache.get(key);
}

const dB = (v) => Math.pow(10, (Number(v) || 0) / 20);
// Mono source into the stereo bus with constant-power pan (centre = unity) and optional ducking under the voice.
function addPanned(L, R, src, at, vol, pan = 0, duck = null) {
  const a = ((Math.min(1, Math.max(-1, Number(pan) || 0)) + 1) * Math.PI) / 4;
  const gl = vol * Math.cos(a) * Math.SQRT2, gr = vol * Math.sin(a) * Math.SQRT2;
  const o = Math.round(at * RATE);
  for (let i = Math.max(0, -o); i < src.length && o + i < L.length; i++) {
    const k = duck ? 0.6 + 0.4 * duck[o + i] : 1;
    L[o + i] += src[i] * gl * k; R[o + i] += src[i] * gr * k;
  }
}

// ---------------- music ----------------
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const MOODS = {
  calm: { bpm: 72, root: 57, scale: 'major', prog: [0, 5, 3, 4], pad: 0.5, arp: 0.15, bass: 0.3, drums: 0, bright: 1800 },
  wonder: { bpm: 84, root: 62, scale: 'lydian', prog: [0, 4, 5, 3], pad: 0.45, arp: 0.35, bass: 0.25, drums: 0, bright: 3200 },
  upbeat: { bpm: 112, root: 60, scale: 'major', prog: [0, 4, 5, 3], pad: 0.3, arp: 0.3, bass: 0.45, drums: 0.7, bright: 3000 },
  tense: { bpm: 96, root: 50, scale: 'minor', prog: [0, 0, 5, 6], pad: 0.4, arp: 0.2, bass: 0.55, drums: 0.35, bright: 1200, pulse: true },
  sad: { bpm: 66, root: 57, scale: 'minor', prog: [0, 5, 2, 6], pad: 0.55, arp: 0.18, bass: 0.25, drums: 0, bright: 1500 },
  epic: { bpm: 100, root: 50, scale: 'minor', prog: [0, 5, 2, 6], pad: 0.5, arp: 0.2, bass: 0.6, drums: 0.9, bright: 2600, big: true },
  mystery: { bpm: 76, root: 52, scale: 'phrygian', prog: [0, 1, 0, 6], pad: 0.45, arp: 0.25, bass: 0.3, drums: 0.15, bright: 1300 },
  playful: { bpm: 120, root: 64, scale: 'major', prog: [0, 3, 4, 0], pad: 0.2, arp: 0.45, bass: 0.4, drums: 0.5, bright: 3800, pluck: true },
};
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10] };

function chordNotes(m, degree) {
  const sc = SCALES[m.scale];
  const at = (d) => m.root + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  return [at(degree), at(degree + 2), at(degree + 4), at(degree + 7)];
}

// Render one music section (stereo) of `sec` seconds.
function renderSection(moodId, sec, intensity, seed) {
  const m = MOODS[moodId] || MOODS.calm;
  const L = buf(sec), R = buf(sec);
  const beat = 60 / m.bpm, bar = beat * 4;
  const r = rng(seed);
  const pad = (f, t0, dur, vol) => {
    const n = Math.round(dur * RATE), o = Math.round(t0 * RATE);
    let p1 = r(), p2 = r(), p3 = r();
    for (let i = 0; i < n && o + i < L.length; i++) {
      const t = i / RATE;
      const e = Math.min(1, t / 0.8) * Math.min(1, (dur - t) / 0.6);
      p1 += f / RATE; p2 += (f * 1.004) / RATE; p3 += (f * 0.996) / RATE;
      const s = (2 * (p1 % 1) - 1) + (2 * (p2 % 1) - 1) * 0.8 + Math.sin(p3 * TAU) * 0.6;
      const v = s * e * vol;
      L[o + i] += v * 0.9; R[o + i] += v * 1.1 * (1 - 0.2 * Math.sin(t * 0.7));
    }
  };
  const pluck = (f, t0, vol, pan = 0) => {
    const dur = m.pluck ? 0.35 : 0.6, n = Math.round(dur * RATE), o = Math.round(t0 * RATE);
    let ph = 0;
    for (let i = 0; i < n && o + i < L.length; i++) {
      const t = i / RATE;
      ph += f / RATE;
      const s = (1 - 4 * Math.abs((ph % 1) - 0.5)) * Math.exp(-t / (m.pluck ? 0.08 : 0.18)) * vol;
      L[o + i] += s * (1 - pan); R[o + i] += s * (1 + pan);
    }
  };
  const kick = (t0, vol) => { const x = tone(0.3, 110, 40, { d: 0.09, vol }); add(L, x, t0); add(R, x, t0); };
  const snare = (t0, vol) => { const x = highpass(noise(0.2, { d: 0.05, vol, seed: Math.floor(t0 * 100) }), 1200); add(L, x, t0, 0.9); add(R, x, t0, 1.1); };
  const hat = (t0, vol) => { const x = highpass(noise(0.05, { d: 0.012, vol, seed: Math.floor(t0 * 300) }), 6000); add(L, x, t0, 1.1); add(R, x, t0, 0.9); };
  const bars = Math.ceil(sec / bar);
  const k = 0.5 + intensity * 0.6;
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const ch = chordNotes(m, m.prog[b % m.prog.length]);
    for (const n of ch.slice(0, 3)) pad(NOTE(n), t0, bar + 0.4, 0.05 * m.pad * k);
    // bass
    const bassN = NOTE(ch[0] - 24);
    for (let q = 0; q < 4; q++) {
      if (!m.pulse && q % 2) continue;
      const x = lowpass(tone(beat * (m.pulse ? 0.9 : 1.8), bassN, bassN, { type: 'saw', a: 0.01, d: m.pulse ? 0.15 : 0.5, vol: 0.22 * m.bass * k }), 400);
      add(L, x, t0 + q * beat); add(R, x, t0 + q * beat);
    }
    // arpeggio
    if (m.arp > 0) {
      const steps = m.bpm > 100 ? 8 : 4;
      for (let s = 0; s < steps; s++) {
        if (r() < 0.25) continue;
        const n = ch[(s * 2 + b) % ch.length] + 12;
        pluck(NOTE(n), t0 + (s * bar) / steps, 0.12 * m.arp * k, (r() - 0.5) * 0.6);
      }
    }
    // drums
    if (m.drums > 0 && intensity > 0.25) {
      const d = m.drums * k;
      for (let q = 0; q < 4; q++) {
        if (q % 2 === 0 || m.big) kick(t0 + q * beat, 0.6 * d);
        if (q % 2 === 1 && !m.pulse) snare(t0 + q * beat, 0.25 * d);
        hat(t0 + q * beat + beat / 2, 0.12 * d);
        if (m.bpm >= 110) hat(t0 + q * beat, 0.07 * d);
      }
    }
  }
  lowpass(L, m.bright); lowpass(R, m.bright);
  // small stereo room: two feedback delays
  for (const [ch, dl] of [[L, 0.137], [R, 0.161]]) {
    const n = Math.round(dl * RATE);
    for (let i = n; i < ch.length; i++) ch[i] += ch[i - n] * 0.28;
  }
  return [L, R];
}

// Each section is levelled to the same RMS before the crossfade, so one loud mood (drums, bass) no longer
// sets the peak for the whole film and pushes every other section 10+ dB down. Mood and intensity then
// shape the level by a few dB on purpose.
const MUSIC_RMS = 0.1; // -20 dBFS per section before mood/intensity trims
const MOOD_TRIM_DB = { calm: -2, wonder: -1.5, upbeat: 1, tense: 0, sad: -3, epic: 2, mystery: 0, playful: 0.5 };
export function renderMusic(sections, duration, seed = 7) {
  const L = buf(duration), R = buf(duration);
  const secs = sections && sections.length ? sections : [{ start: 0, end: duration, mood: 'calm', intensity: 0.5 }];
  secs.forEach((s, i) => {
    const st = Math.max(0, s.start), en = Math.min(duration, s.end ?? duration);
    if (en - st < 0.5) return;
    const xf = 1.2;
    const [l, r] = renderSection(s.mood, en - st + xf, s.intensity ?? 0.5, seed + i * 101);
    const o = Math.round(st * RATE), n = l.length;
    const a0 = Math.min(Math.round(xf * RATE), Math.floor(n / 4));
    let ss = 0;
    for (let k = a0; k < n - a0; k++) ss += l[k] * l[k] + r[k] * r[k];
    const rms = Math.sqrt(ss / Math.max(1, 2 * (n - 2 * a0))) || 1e-9;
    const trim = (MOOD_TRIM_DB[s.mood] ?? 0) + 4 * ((s.intensity ?? 0.5) - 0.5) + (Number(s.gain) || 0);
    const lv = (MUSIC_RMS * Math.pow(10, trim / 20)) / rms;
    for (let k = 0; k < n && o + k < L.length; k++) {
      const t = k / RATE;
      const g = lv * (i === 0 ? 1 : Math.min(1, t / xf)) * Math.min(1, (en - st + xf - t) / xf);
      L[o + k] += l[k] * g; R[o + k] += r[k] * g;
    }
  });
  // fades; only scale down if a section's peaks would exceed full scale
  let pk = 1e-9;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const sc = Math.min(1, 0.95 / pk);
  const fin = Math.min(1, duration);
  for (let i = 0; i < L.length; i++) {
    const t = i / RATE, e = Math.min(1, t / 0.5) * Math.min(1, (duration - t) / fin);
    L[i] *= sc * e; R[i] *= sc * e;
  }
  return [L, R];
}

// Music duck under the narration: a steady dip, not a per-syllable pump. Speech = 50 ms RMS of the
// peak-normalised voice above -40 dBFS (independent of the uploaded file's level). The bed starts dipping
// 250 ms before a line (lookahead), holds 350 ms after speech so short pauses stay ducked, and moves with a
// ~200 ms attack / ~600 ms release. Returns a gain per sample (1 = no duck, DUCK_DEPTH_DB under speech).
export const DUCK_DEPTH_DB = 5.5;
export function duckEnvelope(voice, gain, n) {
  const w = Math.round(0.05 * RATE), look = Math.round(0.25 * RATE), hold = Math.round(0.35 * RATE);
  const thr = Math.pow(10, -40 / 10) * w; // sum of squares over the window at -40 dBFS RMS
  const active = new Uint8Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const v = i < voice.length ? voice[i] * gain : 0;
    acc += v * v;
    if (i >= w) { const u = i - w < voice.length ? voice[i - w] * gain : 0; acc -= u * u; }
    if (acc > thr) active[Math.max(0, i - (w >> 1))] = 1;
  }
  const lastOn = new Int32Array(n), nextOn = new Int32Array(n);
  for (let i = 0, l = -1e9; i < n; i++) { if (active[i]) l = i; lastOn[i] = l; }
  for (let i = n - 1, x = 2e9; i >= 0; i--) { if (active[i]) x = i; nextOn[i] = x; }
  const depth = Math.pow(10, -DUCK_DEPTH_DB / 20);
  const att = 1 - Math.exp(-1 / (0.07 * RATE)), rel = 1 - Math.exp(-1 / (0.2 * RATE));
  const out = new Float32Array(n);
  let y = 1;
  for (let i = 0; i < n; i++) {
    const tgt = i - lastOn[i] <= hold || nextOn[i] - i <= look ? depth : 1;
    y += (tgt - y) * (tgt < y ? att : rel);
    out[i] = y;
  }
  return out;
}

// Speech-band duck: while the voice ducks the bed, the part of the music where speech lives (about
// 300 Hz - 4 kHz: pads, arpeggios) dips a further BAND_DUCK_DB, so words stay clear without pulling the
// whole bed down. Lows and air keep the broadband duck only, so the bed does not audibly pump and its level
// between lines is unchanged. The band dip follows the duck envelope in dB (full BAND_DUCK_DB at the full
// duck, none when the duck is released).
export const BAND_DUCK_DB = 8;
export const SPEECH_BAND_HZ = [300, 4000];

// 2nd-order (Butterworth) RBJ biquad, run in place over x; reverse = run from the end (for zero phase).
function biquad(x, type, f, reverse = false, q = Math.SQRT1_2) {
  const w = (TAU * f) / RATE, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  const b1 = type === 'low' ? 1 - c : -(1 + c), b0 = type === 'low' ? b1 / 2 : -b1 / 2, a0 = 1 + al;
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b0 / a0, A1 = (-2 * c) / a0, A2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const n = x.length;
  for (let k = 0; k < n; k++) {
    const i = reverse ? n - 1 - k : k, v = x[i];
    const y = B0 * v + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}
// Zero-phase speech-band part of x (forward + backward 2nd-order high- and low-pass), so that
// x - band is exactly the rest of the signal and a partial dip of the band never colours the rest.
export function speechBand(x, [lo, hi] = SPEECH_BAND_HZ) {
  const y = Float32Array.from(x);
  for (const reverse of [false, true]) { biquad(y, 'high', lo, reverse); biquad(y, 'low', hi, reverse); }
  return y;
}

// Add the ducked music bed (ml/mr at gain mv) into L/R. duck: per-sample gain from duckEnvelope (or all 1).
export function addDuckedMusic(L, R, ml, mr, duck, mv, bandDuckDb = BAND_DUCK_DB) {
  const n = L.length;
  let ducked = false;
  for (let i = 0; i < n; i++) if (duck[i] < 0.999) { ducked = true; break; }
  if (!ducked || !(bandDuckDb > 0)) {
    for (let i = 0; i < n; i++) { L[i] += ml[i] * mv * duck[i]; R[i] += mr[i] * mv * duck[i]; }
    return;
  }
  const bl = speechBand(ml.subarray(0, n)), br = mr === ml ? bl : speechBand(mr.subarray(0, n));
  const e = bandDuckDb / DUCK_DEPTH_DB; // band dip in dB = e x the duck in dB
  for (let i = 0; i < n; i++) {
    const d = duck[i], g = mv * d, cut = d < 1 ? 1 - Math.pow(d, e) : 0;
    L[i] += (ml[i] - cut * bl[i]) * g; R[i] += (mr[i] - cut * br[i]) * g;
  }
}

// ---------------- mix ----------------
// voiceFile: path or null. musicFile: path or null. returns path of the written WAV.
// sfxLibrary: library folder/json path or a loaded library (falls back to STICKFRAME_SFX_LIBRARY).
export async function mixAudio({ out, duration, voiceFile, musicSections, musicFile, musicMode = 'auto', musicVolume = 0.5, sfx = [], sfxOn = true, sfxLibrary, onProgress }) {
  const n = Math.round(duration * RATE);
  const L = new Float32Array(n), R = new Float32Array(n);
  let voice = null, vg = 1;
  if (voiceFile) {
    onProgress?.(0.1, 'Reading voiceover');
    voice = await decodePcm(voiceFile, RATE);
    let pk = 1e-9;
    for (const v of voice) pk = Math.max(pk, Math.abs(v));
    vg = 0.89 / pk;
    for (let i = 0; i < Math.min(n, voice.length); i++) { L[i] += voice[i] * vg; R[i] += voice[i] * vg; }
  }
  // ducking envelope from the voice (see duckEnvelope)
  const duck = voice ? duckEnvelope(voice, vg, n) : new Float32Array(n).fill(1);
  if (musicMode !== 'none') {
    onProgress?.(0.3, musicMode === 'file' ? 'Reading your music' : 'Composing music');
    let ml, mr;
    if (musicMode === 'file' && musicFile) {
      const m = await decodePcm(musicFile, RATE);
      ml = mr = new Float32Array(n);
      let pk = 1e-9;
      for (const v of m) pk = Math.max(pk, Math.abs(v));
      for (let i = 0; i < n; i++) ml[i] = (m[i % m.length] / pk) * 0.8 * Math.min(1, (duration - i / RATE) / 1.5);
    } else {
      [ml, mr] = renderMusic(musicSections, duration);
    }
    const mv = 0.42 * musicVolume * (voice ? 1 : 1.6);
    addDuckedMusic(L, R, ml, mr, duck, mv);
  }
  if (sfxOn) {
    onProgress?.(0.7, 'Adding sound effects');
    const lib = loadSfxLibrary(sfxLibrary);
    const used = [...new Set(sfx.map((s) => s.sound))].filter((id) => lib?.sounds[id]);
    const samples = new Map(await Promise.all(used.map(async (id) => [id, await sampleBuffer(lib, id)])));
    for (const s of sfx) {
      const smp = samples.get(s.sound);
      const b = smp || sfxBuffer(s.sound);
      if (!b) continue;
      // library samples duck a little under the voice unless "duck": false; synth sounds only when "duck": true
      const v = 0.32 * (s.vol ?? 1) * dB((s.gain ?? 0) + (smp ? lib.sounds[s.sound].gain_db : 0));
      addPanned(L, R, b, s.t, v, s.pan, voice && (s.duck ?? !!smp) ? duck : null);
    }
  }
  // soft clip
  for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * 1.1) / 1.05; R[i] = Math.tanh(R[i] * 1.1) / 1.05; }
  writeWav(out, [L, R], RATE);
  onProgress?.(1, 'Audio ready');
  return out;
}
