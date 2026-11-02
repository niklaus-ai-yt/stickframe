// Stroke-on reveal. Any drawing routine can be recorded through a fake 2D context: its paths come
// back as polylines in stage space, in drawing order. Those lines can then be drawn out one by one
// with a chalk or pencil tip at the end of the line, and cross-fade into the solid drawing.
import { clamp, css, ease, lerp } from './util.js';

const MAT = (a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) => ({ a, b, c, d, e, f });
const mul = (m, n) => MAT(m.a * n.a + m.c * n.b, m.b * n.a + m.d * n.b, m.a * n.c + m.c * n.d, m.b * n.c + m.d * n.d, m.a * n.e + m.c * n.f + m.e, m.b * n.e + m.d * n.f + m.f);

class Recorder {
  constructor(real) {
    this.recording = true;
    this.real = real;
    this.canvas = real?.canvas;
    this.m = MAT();
    this.stack = [];
    this.out = [];
    this.subs = [];
    this.pathId = 0;
    this.tag = null;
    this.lineWidth = 1; this.strokeStyle = '#fff'; this.fillStyle = '#fff'; this.globalAlpha = 1;
    this.font = '10px sans-serif'; this.textAlign = 'start'; this.textBaseline = 'alphabetic';
    this.lineCap = 'butt'; this.lineJoin = 'miter'; this.globalCompositeOperation = 'source-over';
    this.shadowColor = ''; this.shadowBlur = 0; this.miterLimit = 10; this.filter = 'none';
  }
  mark(tag) { this.tag = tag; }
  save() { this.stack.push({ m: this.m, lineWidth: this.lineWidth, strokeStyle: this.strokeStyle, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline }); }
  restore() { const s = this.stack.pop(); if (s) Object.assign(this, s); }
  translate(x, y) { this.m = mul(this.m, MAT(1, 0, 0, 1, x, y)); }
  scale(x, y) { this.m = mul(this.m, MAT(x, 0, 0, y, 0, 0)); }
  rotate(r) { const c = Math.cos(r), s = Math.sin(r); this.m = mul(this.m, MAT(c, s, -s, c, 0, 0)); }
  transform(a, b, c, d, e, f) { this.m = mul(this.m, MAT(a, b, c, d, e, f)); }
  setTransform(a, b, c, d, e, f) { this.m = MAT(a, b, c, d, e, f); }
  getTransform() { return { ...this.m }; }
  P(x, y) { const m = this.m; return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; }
  beginPath() { this.subs = []; this.pathId++; }
  moveTo(x, y) { this.subs.push({ pts: this.P(x, y), closed: false }); this.cur = [x, y]; }
  lineTo(x, y) { if (!this.subs.length) return this.moveTo(x, y); this.subs[this.subs.length - 1].pts.push(...this.P(x, y)); this.cur = [x, y]; }
  quadraticCurveTo(cx, cy, x, y) {
    const [x0, y0] = this.cur || [cx, cy];
    for (let i = 1; i <= 10; i++) { const t = i / 10, u = 1 - t; this.lineTo(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y); }
  }
  bezierCurveTo(a, b, c, d, x, y) {
    const [x0, y0] = this.cur || [a, b];
    for (let i = 1; i <= 14; i++) { const t = i / 14, u = 1 - t; this.lineTo(u * u * u * x0 + 3 * u * u * t * a + 3 * u * t * t * c + t * t * t * x, u * u * u * y0 + 3 * u * u * t * b + 3 * u * t * t * d + t * t * t * y); }
  }
  arc(x, y, r, a0, a1, ccw) { this.ellipse(x, y, r, r, 0, a0, a1, ccw); }
  ellipse(x, y, rx, ry, rot = 0, a0 = 0, a1 = Math.PI * 2, ccw = false) {
    let d = a1 - a0;
    if (ccw && d > 0) d -= Math.PI * 2;
    if (!ccw && d < 0) d += Math.PI * 2;
    const n = Math.max(6, Math.ceil(Math.abs(d) / 0.2)), cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (d * i) / n, px = Math.cos(a) * rx, py = Math.sin(a) * ry, X = x + px * cr - py * sr, Y = y + px * sr + py * cr;
      if (i === 0 && !this.subs.length) this.moveTo(X, Y); else this.lineTo(X, Y);
    }
  }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  closePath() { const s = this.subs[this.subs.length - 1]; if (s) { s.closed = true; s.pts.push(s.pts[0], s.pts[1]); } }
  emit(kind) {
    const style = kind === 'fill' ? this.fillStyle : this.strokeStyle;
    if (typeof style !== 'string' || this.globalAlpha < 0.08) return; // gradients and ghosts are light, not lines
    const k = Math.sqrt(Math.abs(this.m.a * this.m.d - this.m.b * this.m.c)) || 1;
    if (kind === 'stroke') {
      const same = this.out.filter((e) => e.pathId === this.pathId && e.kind === 'fill');
      if (same.length) { same.forEach((e) => { e.w = this.lineWidth * k; e.color = this.strokeStyle; }); return; }
    }
    for (const s of this.subs) {
      if (s.pts.length < 4) continue;
      let len = 0;
      for (let i = 2; i < s.pts.length; i += 2) len += Math.hypot(s.pts[i] - s.pts[i - 2], s.pts[i + 1] - s.pts[i - 1]);
      if (len > 0.01) this.out.push({ pts: s.pts, len, kind, pathId: this.pathId, w: kind === 'stroke' ? this.lineWidth * k : 0, color: style, alpha: this.globalAlpha, tag: this.tag });
    }
  }
  fill() { this.emit('fill'); }
  stroke() { this.emit('stroke'); }
  clip() {}
  fillRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); this.fill(); this.beginPath(); }
  strokeRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.beginPath(); }
  clearRect() {}
  roundRect(x, y, w, h) { this.rect(x, y, w, h); }
  fillText(str, x, y) {
    if (typeof this.fillStyle !== 'string') return;
    const real = this.real;
    if (real) real.font = this.font;
    const width = real ? real.measureText(str).width : String(str).length * 8;
    const k = Math.sqrt(Math.abs(this.m.a * this.m.d - this.m.b * this.m.c)) || 1;
    const left = this.textAlign === 'center' ? x - width / 2 : this.textAlign === 'right' || this.textAlign === 'end' ? x - width : x;
    this.out.push({ text: String(str), x: left, y, m: this.m, font: this.font, base: this.textBaseline, width, len: width * k, color: this.fillStyle, alpha: this.globalAlpha, tag: this.tag });
  }
  strokeText(s, x, y) { this.fillText(s, x, y); }
  measureText(s) { if (this.real) { this.real.font = this.font; return this.real.measureText(s); } return { width: String(s).length * 8 }; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern() { return { }; }
  drawImage() {}
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  putImageData() {}
}

// The lines of a drawing routine, in stage space. Order: 'draw' (as drawn), 'figure' (head, body,
// arms, legs, then the rest), 'outside' (longest lines first).
const FIG = { head: 0, body: 1, arm: 2, leg: 3, face: 4 };
export function recordStrokes(real, draw, order = 'draw') {
  const r = new Recorder(real);
  draw(r);
  let out = r.out;
  if (order === 'figure') out = out.map((e, i) => [e, i]).sort((a, b) => (FIG[a[0].tag] ?? 5) - (FIG[b[0].tag] ?? 5) || a[1] - b[1]).map((x) => x[0]);
  if (order === 'outside') out = out.slice().sort((a, b) => b.len - a.len);
  return out;
}

// Progress (0..1 of the total line length) and the current stroke, for a revealed drawing at time
// a (seconds since the reveal started). steps: [{t, dur, count}] draw the next `count` strokes in
// their own time slot (one element per spoken word); otherwise everything runs over `dur`.
export function revealProgress(strokes, R, lt) {
  const n = strokes.length;
  const lens = strokes.map((s) => s.len);
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  if (R.steps?.length) {
    let i0 = 0, drawn = 0, tip = false;
    for (const st of R.steps) {
      const count = st.count ?? 1, i1 = Math.min(n, i0 + count);
      const seg = lens.slice(i0, i1).reduce((a, b) => a + b, 0);
      const k = clamp((lt - st.t) / (st.dur || 0.5));
      if (k <= 0) break;
      drawn += seg * k;
      tip = k < 1;
      i0 = i1;
    }
    return { len: drawn, total, active: tip, done: i0 >= n && !tip };
  }
  let k = clamp((lt - R.at) / (R.dur || 1));
  if (R.ease) k = ease[R.ease](k);
  if (R.from) k = lerp(R.from, 1, k); // start part-way, or (from: 1) already complete
  return { len: total * k, total, active: k > 0 && k < 1, done: k >= 1 };
}

// Trace the lines up to length `len`. Returns the end of the line {x, y, angle}.
export function traceStrokes(g, strokes, len, o = {}) {
  let left = len, tip = null;
  const color = o.color, width = o.width ?? 4;
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of strokes) {
    if (left <= 0) break;
    const k = left >= s.len ? 1 : left / s.len;
    left -= s.len;
    if (s.text != null) {
      g.save();
      g.transform(s.m.a, s.m.b, s.m.c, s.m.d, s.m.e, s.m.f);
      g.font = s.font; g.textBaseline = s.base; g.textAlign = 'left'; g.fillStyle = color || s.color;
      if (k < 1) { g.beginPath(); g.rect(s.x, s.y - 200, s.width * k, 400); g.clip(); }
      g.fillText(s.text, s.x, s.y);
      g.restore();
      const xe = s.x + s.width * k;
      tip = { x: s.m.a * xe + s.m.c * s.y + s.m.e, y: s.m.b * xe + s.m.d * s.y + s.m.f, angle: 0 };
      continue;
    }
    g.strokeStyle = color || s.color;
    g.lineWidth = s.w ? Math.min(s.w, width) : width;
    g.beginPath();
    g.moveTo(s.pts[0], s.pts[1]);
    let rem = s.len * k, px = s.pts[0], py = s.pts[1], ang = 0;
    for (let i = 2; i < s.pts.length && rem > 0; i += 2) {
      const dx = s.pts[i] - px, dy = s.pts[i + 1] - py, d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      ang = Math.atan2(dy, dx);
      if (d >= rem) { px += (dx / d) * rem; py += (dy / d) * rem; g.lineTo(px, py); rem = 0; break; }
      g.lineTo(s.pts[i], s.pts[i + 1]);
      px = s.pts[i]; py = s.pts[i + 1]; rem -= d;
    }
    g.stroke();
    tip = { x: px, y: py, angle: ang };
  }
  return tip;
}

// Length-independent chalk or pencil tip at a stroke end, in stage px.
export function drawTip(g, tip, kind = 'chalk', S = 1) {
  if (!tip || kind === 'none' || kind === false) return;
  g.save();
  g.translate(tip.x, tip.y);
  g.rotate(-0.75);
  g.lineCap = 'round';
  if (kind === 'pencil' || kind === 'pen') {
    const body = kind === 'pen' ? '#9fd8ff' : '#f7d774';
    g.fillStyle = '#e8d6b0'; g.beginPath(); g.moveTo(0, 0); g.lineTo(6 * S, -16 * S); g.lineTo(-6 * S, -16 * S); g.closePath(); g.fill();
    g.fillStyle = '#2a2a33'; g.beginPath(); g.moveTo(0, 0); g.lineTo(2.2 * S, -6 * S); g.lineTo(-2.2 * S, -6 * S); g.closePath(); g.fill();
    g.strokeStyle = body; g.lineWidth = 12 * S; g.lineCap = 'butt'; g.beginPath(); g.moveTo(0, -16 * S); g.lineTo(0, -70 * S); g.stroke();
  } else {
    g.strokeStyle = '#fbfbf2'; g.lineWidth = 10 * S; g.beginPath(); g.moveTo(0, -3 * S); g.lineTo(0, -36 * S); g.stroke();
    g.fillStyle = 'rgba(255,255,240,0.9)'; g.beginPath(); g.arc(0, 0, 4 * S, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// Draw a revealed thing at local time lt. R: normalised reveal. solid(g): the finished drawing.
// Phases: nothing yet -> lines drawing out -> line drawing held -> cross-fade -> solid.
export function drawReveal(g, R, lt, solid, o = {}) {
  if (lt < R.at) return null;
  const realAt = R.real ? R.realAt ?? R.at + R.dur : Infinity;
  const k = R.real ? clamp((lt - realAt) / R.real) : 0;
  if (k >= 1) { solid(g); return null; }
  const strokes = recordStrokes(g, solid, R.order);
  if (!strokes.length) { solid(g); return null; }
  const P = revealProgress(strokes, R, lt);
  let len = P.len;
  if (R.stop != null) len = Math.min(len, P.total * clamp(R.stop));
  let alpha = 1, color = R.color || '#fbfbf2';
  if (R.dieAt != null && lt > R.dieAt) {
    const d = clamp((lt - R.dieAt) / (R.dieDur || 1));
    alpha = lerp(1, 0.08, d);
    color = `rgb(${Math.round(lerp(251, 120, d))},${Math.round(lerp(251, 128, d))},${Math.round(lerp(242, 122, d))})`;
  }
  let tip = null;
  g.save();
  if (k > 0) { g.save(); g.globalAlpha *= ease.inOut(k); solid(g); g.restore(); }
  const flare = k > 0 ? Math.sin(Math.PI * Math.min(1, k * 1.3)) : 0;
  g.globalAlpha *= alpha * (1 - ease.in(k));
  if (R.glow || flare) { g.shadowColor = css(color, 0.9); g.shadowBlur = (R.glow ? 14 : 0) + flare * 30; }
  tip = traceStrokes(g, strokes, len, { color, width: (R.width ?? 4) * (1 + flare * 0.5) });
  g.restore();
  const drawing = P.active && len < P.total * (R.stop != null ? clamp(R.stop) : 1) - 1e-6 && tip;
  if (drawing && !R.hand) drawTip(g, tip, R.tip, R.tipSize || 1);
  return { tip: drawing ? tip : null, last: tip, progress: len / P.total };
}
