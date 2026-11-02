// Small math, easing, colour and randomness helpers shared by every engine module.
// Runs unchanged in the browser and in Node.

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : clamp((v - a) / (b - a)));
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const ease = {
  linear: (t) => clamp(t),
  in: (t) => { t = clamp(t); return t * t * t; },
  out: (t) => { t = clamp(t); return 1 - Math.pow(1 - t, 3); },
  inOut: (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
  outBack: (t) => { t = clamp(t); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: (t) => {
    t = clamp(t);
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
  },
};

// Deterministic PRNG (mulberry32). Scenes must never use Math.random so that
// preview and export frames are identical.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Stateless noise: same inputs, same value in [0,1).
export function noise1(i, seed = 0) {
  let x = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35);
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Smooth 1D value noise in [-1,1].
export function wobble(t, seed = 0) {
  const i = Math.floor(t), f = t - i;
  const a = noise1(i, seed) * 2 - 1, b = noise1(i + 1, seed) * 2 - 1;
  return lerp(a, b, f * f * (3 - 2 * f));
}

// ---- colour ----
const cache = new Map();
export function rgb(c) {
  if (Array.isArray(c)) return c;
  let v = cache.get(c);
  if (v) return v;
  let s = String(c).trim();
  if (s.startsWith('#')) {
    s = s.slice(1);
    if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
    const n = parseInt(s.slice(0, 6), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    v = m ? m[1].split(',').slice(0, 3).map((x) => parseFloat(x)) : [128, 128, 128];
  }
  cache.set(c, v);
  return v;
}
export const css = (c, a = 1) => {
  const [r, g, b] = rgb(c);
  return a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${clamp(a).toFixed(3)})`;
};
export const mix = (c1, c2, t) => {
  const a = rgb(c1), b = rgb(c2);
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
};
// amt > 0 lightens toward white, < 0 darkens toward black.
export const shade = (c, amt) => (amt >= 0 ? mix(c, '#ffffff', amt) : mix(c, '#000000', -amt));
export const alpha = (c, a) => css(c, a);
export const luma = (c) => { const [r, g, b] = rgb(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

// ---- canvas helpers ----
export function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

export function circle(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, Math.max(0.01, r), 0, TAU);
}

export function ellipse(g, x, y, rx, ry, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU);
}

export function glow(g, x, y, r, color, strength = 0.6) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, css(color, strength));
  gr.addColorStop(0.4, css(color, strength * 0.35));
  gr.addColorStop(1, css(color, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

export function vGrad(g, y0, y1, stops) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => gr.addColorStop(i / Math.max(1, stops.length - 1), css(c)));
  return gr;
}

// Find the time of a word inside a window, used for word-synced events.
export function findWordTime(words, word, from, to) {
  if (!words || !word) return null;
  const want = normWord(word);
  if (!want) return null;
  for (const w of words) {
    if (w.start < from - 0.05 || w.start > to + 0.05) continue;
    const n = normWord(w.text);
    if (n === want || (want.length > 3 && n.startsWith(want))) return w.start;
  }
  // multi-word phrase: match first token
  const first = want.split(' ')[0];
  if (first !== want) return findWordTime(words, first, from, to);
  return null;
}
export const normWord = (s) => String(s).toLowerCase().replace(/[^a-z0-9%$.' ]/g, '').replace(/[.']/g, '').trim();
