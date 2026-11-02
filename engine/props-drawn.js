// Story props drawn the way the figures are: one hand-drawn line with a dark fill in line looks,
// flat colour with a soft outline in the others. Options are plain numbers or flags, so any of them
// can be animated with a prop's "tween". Text always goes through boxText, so it fits.
import { TAU, circle, ellipse, shade, css, mix, glow, lerp, clamp, smooth, noise1, hash, rng } from './util.js';
import { pawPlan, pawAt } from './gait.js';

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const CORAL = '#ff9a88', GOLD = '#f7d774';
export const inkOf = (P) => P.outline || shade(P.propLight, 0.35);
const faint = (P) => mix(inkOf(P), P.wall, 0.45);
const boardOf = (P) => (P.outline ? P.look.figure.headFill : P.prop);
const tint = (P, c, a = 0.35) => (P.outline ? mix(boardOf(P), c, a) : c);

// A hand-drawn line through flat points [x, y, ...]. o: w, c, fill (colour or true), close, smooth,
// j (jitter of the hand, units), seed, a (alpha), dash.
export function sk(g, P, pts, o = {}) {
  const n = pts.length / 2, j = o.j ?? 0.7, seed = o.seed ?? hash(pts.slice(0, 4).join());
  const X = (i) => pts[i * 2] + (j ? (noise1(i, seed) - 0.5) * 2 * j : 0), Y = (i) => pts[i * 2 + 1] + (j ? (noise1(i + 40, seed) - 0.5) * 2 * j : 0);
  g.beginPath();
  g.moveTo(X(0), Y(0));
  if (o.smooth && n > 2) {
    for (let i = 1; i < n - 1; i++) g.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 1)) / 2, (Y(i) + Y(i + 1)) / 2);
    if (o.close) g.quadraticCurveTo(X(n - 1), Y(n - 1), X(0), Y(0)); else g.lineTo(X(n - 1), Y(n - 1));
  } else {
    for (let i = 1; i < n; i++) g.lineTo(X(i), Y(i));
    if (o.close) g.closePath();
  }
  g.lineCap = 'round'; g.lineJoin = 'round';
  const alpha0 = g.globalAlpha;
  if (o.a != null) g.globalAlpha = alpha0 * o.a;
  if (o.fill) { g.fillStyle = o.fill === true ? boardOf(P) : o.fill; g.fill(); }
  if (o.w !== 0) { g.strokeStyle = o.c || inkOf(P); g.lineWidth = o.w ?? 4.5; g.stroke(); }
  g.globalAlpha = alpha0;
}
const ring = (g, P, x, y, rx, ry, o = {}) => {
  const pts = [];
  const n = o.n ?? 18;
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU + (o.rot || 0); pts.push(x + Math.cos(a) * rx, y + Math.sin(a) * ry); }
  sk(g, P, pts, { close: true, smooth: true, ...o });
};
const box = (g, P, x, y, w, h, o = {}) => sk(g, P, [x, y, x + w, y, x + w, y + h, x, y + h], { close: true, ...o });
const dot = (g, c, x, y, r) => { g.fillStyle = c; circle(g, x, y, r); g.fill(); };

// A line along a shape outline with fur bumps. pts: closed outline samples [x, y, ...]
function furry(g, P, pts, o = {}) {
  const n = pts.length / 2, out = [];
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
  cx /= n; cy /= n;
  // soft scallops: alternating points through a smooth curve
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1], d = Math.hypot(x - cx, y - cy) || 1, k = i % 2 ? (o.tuft ?? 5) : -1;
    out.push(x + ((x - cx) / d) * k, y + ((y - cy) / d) * k);
  }
  sk(g, P, out, { close: true, smooth: true, ...o, j: 0 });
}

// ---------- dog ----------
const LEGS4 = { nb: { home: -28, phase: 0 }, nf: { home: 18, phase: 0.25 }, fb: { home: -14, phase: 0.5 }, ff: { home: 34, phase: 0.75 } };
const LEGS3 = { nb: { home: -18, phase: 0 }, nf: { home: 16, phase: 0.42 }, ff: { home: 36, phase: 0.6 } };
const pawMemo = new Map();
function dogGait(o, three) {
  const m = o._move;
  if (!m || !m.D) return null;
  const key = `${three ? 3 : 4}|${m.D.toFixed(2)}`;
  let plan = pawMemo.get(key);
  if (!plan) { if (pawMemo.size > 64) pawMemo.clear(); pawMemo.set(key, plan = three ? pawPlan(m.D, 122, 0.44, LEGS3) : pawPlan(m.D, 112, 0.62, LEGS4)); }
  return { plan, d: clamp(m.d, 0, m.D) };
}
export function dogPaws(o, three) { // world-independent paws for tests: {key: {x, up, phase, plant}}
  const G = dogGait(o, three);
  if (!G) return null;
  const out = {};
  for (const k of Object.keys(G.plan.steps)) out[k] = pawAt(G.plan, k, G.d, three ? 18 : 12);
  return out;
}
function drawDog(g, P, t, o, three) {
  const main = o.color && !P.outline ? o.color : !P.outline ? '#c89a5a' : boardOf(P);
  const line = P.outline ? o.color || inkOf(P) : shade(main, -0.42);
  const far = P.outline ? mix(line, P.wall, 0.42) : shade(main, -0.28);
  const lw = 5;
  const wag = Math.sin(t * (o.sleep ? 2 : 11)) * (o.sleep ? 0.05 : 0.42);
  const fluffy = !!o.fluffy;
  const outline = (pts, oo = {}) => (fluffy ? furry(g, P, pts, { w: lw, c: line, fill: main, j: 0.25, ...oo }) : sk(g, P, pts, { w: lw, c: line, fill: main, close: true, smooth: true, j: 0.4, ...oo }));
  const blob = (x, y, rx, ry, rot = 0, n = fluffy ? 26 : 16) => { const pts = []; const c = Math.cos(rot), s = Math.sin(rot); for (let i = 0; i < n; i++) { const a = (i / n) * TAU, px = Math.cos(a) * rx, py = Math.sin(a) * ry; pts.push(x + px * c - py * s, y + px * s + py * c); } return pts; };
  const head = (hx, hy, r = 17, sleepy = false) => {
    outline(blob(hx, hy, r, r * 0.95), { tuft: 3 });
    // a blunt muzzle with a big nose, and a small tongue when awake
    ring(g, P, hx + r * 0.95, hy + 4.5, 11.5, 8, { w: lw * 0.85, c: line, fill: main, n: 12, j: 0.1 });
    dot(g, line, hx + r * 0.95 + 9.5, hy + 1, 4);
    sk(g, P, [hx + r * 0.95 + 5, hy + 7, hx + r * 0.95 + 1, hy + 10], { w: 2.2, c: line, j: 0 });
    if (!sleepy && o.tongue !== false) sk(g, P, [hx + r * 0.95 + 2, hy + 11, hx + r * 0.95 + 3, hy + 16], { w: 4, c: tint(P, CORAL, 0.75), j: 0 });
    if (sleepy) sk(g, P, [hx + 2, hy - 3, hx + 10, hy - 3], { w: 3, c: line, j: 0 });
    else { dot(g, line, hx + 6, hy - 4, 3.2); }
    // floppy ear over the head
    sk(g, P, [hx - 4, hy - r * 0.85, hx - r * 0.95, hy - r * 0.75, hx - r * 1.05, hy + r * 0.45, hx - r * 0.45, hy + r * 0.5, hx - r * 0.2, hy - r * 0.2], { w: lw * 0.85, c: line, fill: tint(P, line, 0.22), smooth: true, close: true, j: 0.2 });
  };
  if (o.sleep) { // curled on the ground, nose on its paws
    const br = 1 + Math.sin(t * 1.6) * 0.03;
    sk(g, P, [-40, -10, -54, -12, -56, -2, -30, -2], { w: lw, c: line, fill: main, smooth: true, j: 0.2 });
    outline(blob(-6, -21 * br, 38, 20 * br));
    sk(g, P, [20, -3, 42, -3], { w: lw, c: line, j: 0.2 });
    head(30, -16, 13.5, true);
    return;
  }
  if (o.sit) {
    sk(g, P, [-24, -14, -44, -24 - wag * 18, -56, -44 - wag * 26], { w: lw * (fluffy ? 1.8 : 1), c: line, smooth: true, j: 0.2 });
    if (!three) sk(g, P, [16, -38, 22, -18, 24, 0, 31, 0], { w: lw, c: far, j: 0.2 });
    sk(g, P, [-14, -12, 10, -8, 0, -2, 14, -2], { w: lw, c: line, smooth: true, j: 0.2 }); // folded back leg
    sk(g, P, [24, -38, 28, -18, 28, 0, 36, 0], { w: lw, c: three ? far : line, j: 0.2 });
    if (three) sk(g, P, [12, -36, 15, -16, 14, 0, 22, 0], { w: lw, c: line, j: 0.2 });
    outline(blob(0, -32, 24, 32, 0.32));
    head(16, -70);
    return;
  }
  // standing, walking, hopping or carried
  const G = dogGait(o, three), legs = three ? LEGS3 : LEGS4;
  const env = G ? smooth(G.d / 34) * smooth((o._move.D - G.d) / 34) : 0;
  const c = G ? G.d / G.plan.C : 0;
  const lift = 0;
  // body motion: a three-legged dog hops from its single back leg and lands on the front pair
  const hop = three ? Math.max(0, Math.sin(TAU * (c - 0.05))) * 11 * env : Math.sin(TAU * 2 * c) * 1.6 * env;
  const pitch = three ? Math.sin(TAU * (c + 0.05)) * 0.1 * env : 0;
  const py = -46 - hop + lift;
  const J = (hx, hy) => ({ x: hx, y: hy });
  const shoulder = (x) => J(x * Math.cos(pitch), py + x * Math.sin(pitch));
  const leg = (key, col) => {
    const L = legs[key], back = key[1] === 'b';
    const top = shoulder(back ? L.home + 2 : L.home - 2);
    const hang = o.carried;
    const paw = hang ? { x: L.home + (back ? -8 : 6) + Math.sin(t * 2 + L.home) * 1.5, up: 3 } : G ? pawAt(G.plan, key, G.d, three ? 18 : 12) : { x: L.home, up: 0 };
    const px0 = hang ? paw.x : G ? paw.x : L.home, py0 = -paw.up - 2.5;
    const mx = (top.x + px0) / 2 + (back ? -7 : 5), my = (top.y + py0) / 2;
    sk(g, P, [top.x, top.y, mx, my, px0, py0], { w: lw * (fluffy ? 1.15 : 1), c: col, j: 0 });
    sk(g, P, [px0, py0, px0 + 7, py0], { w: lw * 1.05, c: col, j: 0 }); // paw
  };
  if (!three) leg('fb', far);
  leg('ff', far);
  // tail, wagging from the rump
  g.save();
  g.translate(-36, py - 8 - pitch * 34);
  g.rotate(-0.72 + wag);
  sk(g, P, [0, 0, -14, -3, -28, -11], { w: lw * (fluffy ? 2.2 : 1.05), c: line, smooth: true, j: 0.2 });
  if (fluffy) sk(g, P, [-4, -6, -14, -12, -24, -18], { w: lw * 0.7, c: line, smooth: true, j: 0.2 });
  g.restore();
  leg('nb', line);
  leg('nf', line);
  g.save();
  g.translate(0, py + 2);
  g.rotate(pitch);
  outline(blob(0, 0, 38, 17));
  g.restore();
  // marks the spot of a hidden leg
  if (o.hiddenLeg) { g.save(); g.setLineDash?.([5, 4]); ring(g, P, -2, -12, 14, 15, { w: 3, c: CORAL, j: 0.3 }); g.setLineDash?.([]); g.restore(); }
  head(38 * Math.cos(pitch) + 4, py - 24 + 38 * Math.sin(pitch));
  if (o.nametag) { dot(g, GOLD, 28, py - 8, 4); }
}

// ---------- figure-sized helpers ----------
function bird(g, P, kind, flat, flapPhase, o) {
  const c = o.color || inkOf(P);
  const body = kind === 'heron' ? 1.25 : kind === 'swallow' ? 0.8 : 1;
  const wing = kind === 'heron' ? 62 : kind === 'swallow' ? 40 : 52;
  const a0 = g.globalAlpha;
  if (flat < 1) { // alive: side view with flapping wings
    g.globalAlpha = a0 * (1 - flat);
    const fillC = P.outline ? boardOf(P) : o.color || P.propLight, w = 4.4;
    const up = Math.sin(flapPhase) * 0.95 + 0.1;
    if (kind === 'swallow') sk(g, P, [-14, 2, -36, -4, -24, 2, -38, 9, -14, 5], { w, c, j: 0.2 }); // forked tail
    else sk(g, P, [-14, 1, -30, 6, -14, 6], { w, c, fill: fillC, j: 0.2 });
    const leaf = (amp, dx, col) => {
      const ty = -amp * wing, tx = -22 + Math.abs(amp) * 6 + dx;
      sk(g, P, [5 + dx, -2, -2 + dx + tx * 0.12, ty * 0.72 - 4, tx, ty, tx * 0.72, ty * 0.42 + 3, -12 + dx, 3], { w, c: col, fill: fillC, smooth: true, close: true, j: 0.2 });
    };
    leaf(up * 0.82, 7, mix(c, P.wall, 0.35));
    ring(g, P, 0, 0, 18 * body, 7.5 * body, { w, c, fill: fillC, j: 0.2, n: 12 });
    leaf(up, 0, c);
    if (kind === 'heron') {
      sk(g, P, [14, -3, 28, -8, 40, -16], { w, c, smooth: true, j: 0.2 });
      ring(g, P, 45, -19, 5.5, 4.5, { w, c, j: 0, n: 10 });
      sk(g, P, [49, -19, 68, -15], { w: w * 0.8, c: GOLD, j: 0 });
      sk(g, P, [-12, 4, -42, 12], { w: w * 0.7, c, j: 0.2 });
    } else {
      ring(g, P, 17, -5, 6.5, 6, { w, c, fill: fillC, j: 0, n: 10 });
      sk(g, P, [23, -5, 33, -3, 23, -1], { w: w * 0.7, c: kind === 'swallow' ? c : GOLD, j: 0 });
      dot(g, c, 19, -6, 1.3);
    }
  }
  if (flat > 0) { // chalk on the pavement: drawn from above, wings spread, seen at a low angle
    g.globalAlpha = a0 * flat;
    g.save();
    g.scale(1, 0.62);
    const w = 3.2, len = kind === 'heron' ? 30 : 22;
    for (const s of [-1, 1]) sk(g, P, [2, s * 4, 2 - wing * 0.25, s * wing * 0.55, -8 - wing * 0.1, s * wing, -14, s * wing * 0.35, -10, s * 4], { w, c, smooth: true, close: true, j: 0.5 });
    ring(g, P, 0, 0, len, 6.5, { w, c, n: 12, j: 0.3 });
    ring(g, P, len + 6, 0, 6, 5.5, { w, c, n: 10, j: 0.2 });
    sk(g, P, [len + 12, 0, len + 22, 0], { w: w * 0.9, c: kind === 'gull' ? GOLD : c, j: 0 });
    if (kind === 'swallow') sk(g, P, [-len, -3, -len - 16, -9, -len - 6, 0, -len - 16, 9, -len, 3], { w, c, j: 0.3 });
    else sk(g, P, [-len, -4, -len - 14, 0, -len, 4], { w, c, j: 0.3 });
    if (kind === 'heron') { sk(g, P, [len + 22, 0, len + 46, 0], { w, c: GOLD, j: 0 }); sk(g, P, [-len, 0, -len - 26, 6], { w: w * 0.7, c, j: 0.2 }); }
    g.restore();
  }
  g.globalAlpha = a0;
}
const birdDraw = (kind) => (g, P, t, o) => {
  const flat = clamp(o.flat ?? 0), f = o.flap ?? 1;
  const shake = o.shake ? Math.sin(t * 40) * 2.4 * o.shake : 0;
  const k = kind || o.kind || 'gull';
  g.translate(shake, 0);
  g.scale(1.8, 1.8);
  bird(g, P, k, flat, t * 13 * f + (o.seed || 0), o);
};

// Rig of the bike: axle heights rock when the wheels are oval. In prop units.
const SADDLE = { x: -16, y: -70 }, BARS = { x: 28, y: -84 }, CRANK = { x: -4, y: -30 };
export function rideRig(type, o, t = 0) {
  const d = o._move ? o._move.d : o.roll || 0;
  const th = d / 28 + (o.spin ? t * o.spin : 0);
  const oval = o.oval ? 1 : 0;
  const R = 28, rx = lerp(R, 33, oval), ry = lerp(R, 20, oval);
  const h = (a) => Math.sqrt((rx * Math.sin(a)) ** 2 + (ry * Math.cos(a)) ** 2);
  const hr = h(th), hf = h(th + 1.2);
  const lur = (hr + hf) / 2 - (oval ? (rx + ry) / 2 : R);
  const pitch = Math.atan2(hr - hf, 92);
  const rot = (q) => ({ x: q.x * Math.cos(pitch) - (q.y) * Math.sin(pitch), y: q.x * Math.sin(pitch) + q.y * Math.cos(pitch) - lur });
  const pa = th * 0.9, pr = 11;
  const pedal = (a) => rot({ x: CRANK.x + Math.cos(a) * pr, y: CRANK.y + Math.sin(a) * pr });
  return { th, hr, hf, rx, ry, lur, pitch, oval, saddle: rot(SADDLE), bars: rot(BARS), crank: rot(CRANK), pedals: [pedal(pa), pedal(pa + Math.PI)], rot };
}
function drawBike(g, P, t, o) {
  const R = rideRig('bike', o, t);
  const c = inkOf(P), hot = o.color || (P.outline ? GOLD : P.ui.hot);
  const w = 4.6;
  const wheel = (x, ax, phase, col) => {
    g.save(); g.translate(x, -ax); g.rotate(phase);
    ring(g, P, 0, 0, R.rx, R.ry, { w, c: col, j: 0.3, n: 22 });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI; sk(g, P, [-Math.cos(a) * R.rx, -Math.sin(a) * R.ry, Math.cos(a) * R.rx, Math.sin(a) * R.ry], { w: 1.6, c: col, a: 0.6, j: 0 }); }
    g.restore();
  };
  const wc = R.oval ? (o.color || CORAL) : c;
  wheel(-46, R.hr, R.th, wc);
  wheel(46, R.hf, R.th + 1.2, wc);
  const q = (x, y) => R.rot({ x, y });
  const P1 = [[-46, -R.hr + R.lur], [CRANK.x, CRANK.y], [20, -70], [SADDLE.x + 4, SADDLE.y + 4]];
  const pts = (arr) => arr.flatMap(([x, y]) => { const r = q(x, y); return [r.x, r.y]; });
  sk(g, P, pts(P1.concat([[-46, -R.hr + R.lur]])), { w: 5.2, c: hot, j: 0.3 });
  sk(g, P, pts([[CRANK.x, CRANK.y], [SADDLE.x + 4, SADDLE.y + 4]]), { w: 5.2, c: hot, j: 0.2 });
  sk(g, P, pts([[46, -R.hf + R.lur], [20, -70], [BARS.x - 2, BARS.y + 2]]), { w: 5.2, c: hot, j: 0.2 });
  const s = q(SADDLE.x - 8, SADDLE.y), s2 = q(SADDLE.x + 10, SADDLE.y);
  sk(g, P, [s.x, s.y, s2.x, s2.y], { w: 6, c, j: 0 });
  const b = q(BARS.x, BARS.y), b2 = q(BARS.x + 12, BARS.y - 4);
  sk(g, P, [b.x, b.y, b2.x, b2.y], { w: 5, c, j: 0 });
  // crank and pedals
  const [p1, p2] = R.pedals, cr = R.crank;
  sk(g, P, [p1.x, p1.y, cr.x, cr.y, p2.x, p2.y], { w: 3.4, c, j: 0 });
  for (const p of [p1, p2]) sk(g, P, [p.x - 5, p.y, p.x + 5, p.y], { w: 4.2, c, j: 0 });
}

// ---------- hand ----------
function drawHandProp(g, P, t, o) {
  const tr = o.tremble || 0;
  if (tr) g.translate(Math.sin(t * 47) * 2.6 * tr + Math.sin(t * 29) * 1.4 * tr, Math.cos(t * 41) * 2.2 * tr);
  const c = o.color || inkOf(P), w = o.thin ? 3.4 : 9;
  const fill = o.thin ? null : boardOf(P);
  const tool = o.tool === undefined ? 'pencil' : o.tool;
  const pose = o.pose || (tool && tool !== 'none' ? 'grip' : 'open');
  const a = o.angle ?? -0.95; // tool direction from the tip
  // arm: false hides the forearm; "long" (or a number, a length multiplier) reaches further off-frame
  const armK = o.arm === false ? 0 : o.arm === 'long' ? 4 : typeof o.arm === 'number' ? o.arm : 1;
  const armLine = (x0, y0, x1, y1, st) => { if (armK) sk(g, P, [x0, y0, x0 + (x1 - x0) * armK, y0 + (y1 - y0) * armK], st); };
  if (pose === 'simple' || pose === 'fist') {
    // a plain solid hand that reads at any size: origin at the palm, fingers toward "angle"
    const solid = o.color || inkOf(P), fa = o.angle ?? -1.2;
    g.save(); g.rotate(fa);
    armLine(-22, 0, -170, 0, { w: 15, c: solid, j: 0.3 });
    g.fillStyle = solid; g.strokeStyle = solid; g.lineCap = 'round';
    if (pose === 'fist') {
      g.beginPath(); g.ellipse(2, 0, 30, 27, 0, 0, Math.PI * 2); g.fill();
      g.lineWidth = 11; g.beginPath(); g.moveTo(-6, 26); g.lineTo(20, 26); g.stroke();
    } else {
      g.beginPath(); g.ellipse(0, 0, 30, 27, 0, 0, Math.PI * 2); g.fill();
      g.lineWidth = 12;
      for (let i = 0; i < 4; i++) { const y = -20 + i * 13.5; g.beginPath(); g.moveTo(22, y); g.lineTo(68 - Math.abs(i - 1.4) * 7, y * 1.3); g.stroke(); }
      g.lineWidth = 14; g.beginPath(); g.moveTo(-8, 22); g.lineTo(22, 50); g.stroke();
    }
    g.restore();
  } else if (pose === 'grip') {
    const fx = Math.cos(a) * 62, fy = Math.sin(a) * 62; // fist on the tool, above its tip
    if (tool === 'pencil' || tool === 'pen' || tool === 'chalk') {
      g.save(); g.rotate(a);
      if (tool === 'chalk') sk(g, P, [3, 0, 96, 0], { w: 13, c: '#fbfbf2', j: 0 });
      else {
        sk(g, P, [0, 0, 22, -7.5, 22, 7.5], { w: 3, close: true, fill: '#e8d6b0', c, j: 0 });
        dot(g, tool === 'pen' ? '#9fd8ff' : '#2a2a33', 3.5, 0, 3);
        box(g, P, 22, -7.5, 104, 15, { w: 3.2, c, fill: tool === 'pen' ? tint(P, '#9fd8ff', 0.5) : tint(P, GOLD, 0.8), j: 0.2 });
      }
      g.restore();
    }
    // forearm in from off-frame, then a closed fist with fingers wrapped over the tool
    armLine(fx + 14, fy + 18, fx + 110, fy + 170, { w: w * 1.5, c, j: 0.4 });
    ring(g, P, fx + 6, fy + 2, 30, 25, { w: w * 0.8, c, fill: fill || undefined, j: 0.3, n: 14 });
    for (let i = 0; i < 3; i++) {
      const k = i - 1, x0 = fx - 8 + k * 5, y0 = fy + 4 + k * 14;
      sk(g, P, [x0 + 22, y0 + 4, x0 - 16, y0 - 2, x0 - 18, y0 + 6], { w: w * 0.62, c, smooth: true, j: 0.2 });
    }
    sk(g, P, [fx + 22, fy - 18, fx - 8, fy - 26, fx - 16, fy - 18], { w: w * 0.72, c, smooth: true, j: 0.2 }); // thumb
  } else if (pose === 'palm') { // open palm up, origin at the middle of the palm
    armLine(50, 12, 170, 90, { w: w * 1.5, c, j: 0.4 });
    sk(g, P, [-40, -6, 40, -8, 54, 14, -32, 18], { w: w * 0.8, c, close: true, smooth: true, fill: fill || undefined, j: 0.3 });
    for (let i = 0; i < 4; i++) sk(g, P, [-34, -2 + i * 5, -84 + i * 5, -14 + i * 9], { w: w * 0.62, c, j: 0.2 });
    sk(g, P, [24, -6, 18, -36], { w: w * 0.72, c, j: 0.2 });
  } else if (pose === 'point') { // a finger, origin at its tip
    sk(g, P, [0, 0, 38, -38], { w: w * 0.95, c, j: 0.2 });
    ring(g, P, 54, -44, 28, 25, { w: w * 0.8, c, fill: fill || undefined, j: 0.3, n: 14 });
    armLine(70, -28, 170, 110, { w: w * 1.5, c, j: 0.4 });
    for (let i = 0; i < 3; i++) sk(g, P, [38, -40 + i * 11, 62, -24 + i * 11], { w: w * 0.55, c, j: 0.1 });
  } else { // open hand reaching in, origin at the palm
    armLine(12, 14, 120, 150, { w: w * 1.5, c, j: 0.4 });
    ring(g, P, 0, 0, 27, 24, { w: w * 0.8, c, fill: fill || undefined, j: 0.3, n: 14 });
    for (let i = 0; i < 4; i++) { const an = -2.5 + i * 0.42; sk(g, P, [Math.cos(an) * 22, Math.sin(an) * 22, Math.cos(an) * 62, Math.sin(an) * 62], { w: w * 0.62, c, j: 0.3 }); }
    sk(g, P, [22, -10, 52, -18], { w: w * 0.7, c, j: 0.3 });
  }
  if (o.bandage) {
    const cx = pose === 'grip' ? Math.cos(a) * 62 + 6 : 2, cy = pose === 'grip' ? Math.sin(a) * 62 + 2 : 2;
    for (let i = -1; i <= 1; i++) sk(g, P, [cx - 26, cy + i * 10, cx + 26, cy + i * 10 - 4], { w: 7, c: '#fbfbf2', j: 0.8 });
  }
}

// ---------- the sagging plank ----------
// How far a deck sags at stage x under loads [{x, w}] (stage px).
export function deckDip(x, loads) {
  if (!loads) return 0;
  let d = 0;
  for (const l of loads) { const u = (x - l.x) / 90; d += l.w * 9 * Math.exp(-u * u); }
  return d;
}
const toLocal = (o, sx, fallback) => (o._W != null ? (sx * o._W - o._x) / (o._size || 1) : fallback);
function drawFootbridge(g, P, t, o) {
  const size = o._size || 1, X0 = -200, X1 = 200, deckY = -10;
  const c = inkOf(P);
  const gapW = o.gapW ?? 26;
  const gapU = typeof o.gap === 'number' ? toLocal(o, o.gap, (o.gap - 0.5) * 400) : null;
  const splitU = typeof o.split === 'number' ? toLocal(o, o.split, (o.split - 0.5) * 400) : null;
  const dip = (u) => deckDip((o._x ?? 0) + u * size, o._loads) / size;
  if (o.part !== 'rail') {
    // posts into the water, stringers under the deck
    for (const u of [-180, -96, 96, 180]) sk(g, P, [u - 3, deckY + dip(u), u + 3, 96], { w: 5, c: faint(P), j: 1.2 });
    const left = gapU != null ? gapU - gapW / 2 : X1, right = gapU != null ? gapU + gapW / 2 : X0;
    const beam = (a, b) => sk(g, P, [a, deckY + 8 + dip(a), (a + b) / 2, deckY + 8 + dip((a + b) / 2), b, deckY + 8 + dip(b)], { w: 3.5, c: faint(P), smooth: true, j: 0.5 });
    if (gapU != null) { beam(X0, left); beam(right, X1); } else beam(X0, X1);
    // planks
    const n = Math.round((X1 - X0) / 17);
    for (let i = 0; i < n; i++) {
      const a = X0 + (i * (X1 - X0)) / n, b = a + (X1 - X0) / n - 1.5, mid = (a + b) / 2;
      if (gapU != null && mid > gapU - gapW / 2 && mid < gapU + gapW / 2) continue;
      const crack = splitU != null && a < splitU && b > splitU;
      const yy = deckY + dip(mid) + (noise1(i, 7) - 0.5) * 1.6;
      const tilt = crack ? clamp(o.crack ?? 1) * 5 : 0;
      sk(g, P, [a, yy - 3 + tilt * 0.3, b, yy - 3 - tilt * 0.3, b, yy + 4, a, yy + 4], { w: 2.8, c: crack ? CORAL : c, fill: boardOf(P), close: true, j: 0.25, seed: i + 5 });
      if (crack) { const k = clamp(o.crack ?? 1); sk(g, P, [mid - 4, yy - 3, mid + 2, yy - 1, mid - 3, yy + 1, mid + 3, yy + 3.5 * k], { w: 2.4, c: CORAL, j: 0.3 }); }
    }
    if (gapU != null) {
      // broken plank ends, marked; a thin beam may span the gap
      sk(g, P, [left, deckY - 6, left - 2, deckY + 8], { w: 3.4, c: CORAL, j: 0.5 });
      sk(g, P, [right, deckY - 6, right + 2, deckY + 8], { w: 3.4, c: CORAL, j: 0.5 });
      if (o.beam) sk(g, P, [left - 6, deckY + 3 + dip(left), gapU, deckY + 4 + dip(gapU) + Math.sin(t * 7) * 0.4, right + 6, deckY + 3 + dip(right)], { w: 3, c: c, smooth: true, j: 0.2 });
    }
  }
  if (o.part !== 'deck' && o.rail !== false) {
    // the hand-drawn wobbly rail with its kink, near side of the camera
    const shake = (o.groan ?? 0) * Math.sin(t * 24) * 1.2;
    const pts = [];
    const kink = o.kink != null ? toLocal(o, o.kink, (o.kink - 0.5) * 400) : 60;
    for (let i = 0; i <= 16; i++) {
      const u = X0 + (i * (X1 - X0)) / 16;
      const k = Math.exp(-(((u - kink) / 16) ** 2)) * 9;
      pts.push(u, -50 + Math.sin(i * 1.9) * 2.6 + k + shake);
    }
    sk(g, P, pts, { w: 4, c, smooth: true, j: 0.8, seed: 11 });
    for (let i = 0; i <= 8; i++) {
      const u = X0 + (i * (X1 - X0)) / 8;
      sk(g, P, [u, deckY + dip(u) - 2, u + (noise1(i, 3) - 0.5) * 7, -50 + (noise1(i, 4) - 0.5) * 4], { w: 3, c, j: 0.8, seed: i });
    }
  }
}
function drawLineProp(g, P, t, o) {
  const size = o._size || 1, W = o._W ?? 1920, H = o._H ?? 1080, x0 = o._x ?? W / 2, y0 = o._y ?? H / 2;
  const groups = Array.isArray(o.lines) ? o.lines : Array.isArray(o.points) ? [o.points] : [];
  g.strokeStyle = o.color || inkOf(P);
  g.lineWidth = num(o.width, 4) / size;
  g.lineCap = o.cap || 'round'; g.lineJoin = 'round';
  for (const pts of groups) {
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const X = (q) => (q[0] * W - x0) / size, Y = (q) => (q[1] * H - y0) / size;
    g.beginPath(); g.moveTo(X(pts[0]), Y(pts[0]));
    if (o.smooth && pts.length > 2) {
      for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(X(pts[i]), Y(pts[i]), (X(pts[i]) + X(pts[i + 1])) / 2, (Y(pts[i]) + Y(pts[i + 1])) / 2);
      g.lineTo(X(pts[pts.length - 1]), Y(pts[pts.length - 1]));
    } else for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i]), Y(pts[i]));
    if (o.closed) g.closePath();
    if (o.fill) { g.fillStyle = o.fill; g.fill(); }
    g.stroke();
  }
}
function drawCreek(g, P, t, o) {
  const size = o._size || 1;
  const a = toLocal(o, (o.banks?.[0] ?? 0.25), -240), b = toLocal(o, (o.banks?.[1] ?? 0.75), 240);
  const L = clamp(o.level ?? 0.2), H = num(o.depth, 195) / size; // depth: stage px from the bank line to the bed
  const lvl = lerp(H * 0.82, H * 0.08, L);
  const amp = (o.rough ?? 0.5) * 5;
  const dark = P.outline ? mix(P.ground, '#000000', 0.4) : P.floorDark;
  sk(g, P, [a + 8, 0, b - 8, 0, b - 28, H + 12, a + 28, H + 12], { w: 0, close: true, fill: dark, j: 0.3 });
  const water = (y, ph, w, al) => {
    const pts = [];
    const n = 22;
    for (let i = 0; i <= n; i++) { const u = lerp(a + 2, b - 2, i / n); pts.push(u, y + Math.sin(i * 1.3 + t * 3.2 + ph) * amp + Math.sin(i * 0.5 - t * 1.9 + ph) * amp * 0.5); }
    sk(g, P, pts, { w, c: mix(inkOf(P), P.water, 0.35), a: al, smooth: true, j: 0 });
  };
  // body of water, then its moving lines
  const body = [];
  const n = 22;
  for (let i = 0; i <= n; i++) { const u = lerp(a + (lvl / H) * 26, b - (lvl / H) * 26, i / n); body.push(u, lvl + Math.sin(i * 1.3 + t * 3.2) * amp + Math.sin(i * 0.5 - t * 1.9) * amp * 0.5); }
  body.push(b - 22, H + 6, a + 22, H + 6);
  sk(g, P, body, { w: 0, close: true, fill: css(P.water, 0.8), j: 0 });
  water(lvl, 0, 3.6, 1);
  for (let k = 1; k <= 4; k++) { const y = lvl + k * 22 / size; if (y < H) water(y, k * 1.7, 2.4, 0.5 - k * 0.07); }
  // bank lines
  sk(g, P, [a - 30, 0, a + 8, 0, a + 28, H], { w: 3.6, c: faint(P), j: 1 });
  sk(g, P, [b + 30, 0, b - 8, 0, b - 28, H], { w: 3.6, c: faint(P), j: 1 });
}

// ---------- the small stuff ----------
function drawSandwich(g, P, t, o) {
  const c = inkOf(P);
  const bread = tint(P, '#e8c98f', 0.5);
  if (o.wrapped) {
    sk(g, P, [-50, 18, -44, -26, 44, -26, 50, 18], { close: true, w: 4.5, fill: tint(P, '#c8d0c0', 0.45) });
    sk(g, P, [-48, -4, 48, -4], { w: 3, c: GOLD });
    sk(g, P, [-14, -26, -8, 18], { w: 3, c: GOLD });
    return;
  }
  // a stacked sandwich held by a pick: square bread, filling that shows at the edges
  sk(g, P, [-50, 14, 50, 14, 50, 28, -50, 28], { close: true, w: 4.5, fill: bread, j: 0.4 });
  sk(g, P, [-54, 9, -36, 14, -18, 8, 0, 14, 18, 8, 36, 14, 54, 9], { w: 6.5, c: tint(P, '#8fd08a', 0.95), smooth: true, j: 0.3 }); // lettuce
  sk(g, P, [-44, 2, 44, 2], { w: 8, c: tint(P, '#ffb0a0', 0.8), j: 0.2 }); // tomato
  sk(g, P, [-48, -4, 48, -4, 26, -4, 8, 4, -10, -4], { w: 3, close: true, fill: tint(P, GOLD, 0.8), j: 0.2 }); // cheese corner
  sk(g, P, [-50, -6, -52, -22, -40, -24, 40, -24, 52, -22, 50, -6], { close: true, w: 4.5, fill: bread, j: 0.4 });
  sk(g, P, [0, -22, 0, -46], { w: 2.6, c, j: 0 }); dot(g, tint(P, '#8fd08a', 1), 0, -50, 5);
  if (o.steam) for (let i = 0; i < 3; i++) {
    const x = -22 + i * 22, k = (t * 0.7 + i * 0.33) % 1;
    sk(g, P, [x + 14, -30 - k * 10, x + 14 + 6 * Math.sin(t * 2 + i), -44 - k * 16, x + 9, -58 - k * 18], { w: 3, smooth: true, a: Math.sin(Math.PI * k) * (o.steam === true ? 0.9 : o.steam), j: 0 });
  }
}
function drawNotebook(g, P, t, o, PROPS, boxText) {
  const c = o.color || inkOf(P), sag = clamp(o.sag ?? 0);
  const paper = P.outline ? mix(boardOf(P), '#f6f4e6', 0.14) : '#f6f4ee';
  const d = (x) => sag * 14 * (1 - (x / 62) ** 2); // the middle sinks
  const edge = (y) => { const pts = []; for (let i = 0; i <= 10; i++) { const x = -62 + i * 12.4; pts.push(x, y + d(x)); } return pts; };
  if (o.glow && !P.outline === false) glow(g, 0, 0, 120, GOLD, 0.35 * o.glow);
  else if (o.glow) glow(g, 0, 0, 120, GOLD, 0.35 * o.glow);
  const top = edge(-36), bot = edge(36);
  const outline = top.concat(bot.reduceRight((acc, _, i, a) => (i % 2 ? (acc.push(a[i - 1], a[i]), acc) : acc), []));
  sk(g, P, outline, { close: true, w: 4.5, c, fill: paper, smooth: false, j: 0.3 });
  sk(g, P, [0, -36 + d(0), 0, 36 + d(0)], { w: 3, c, a: 0.8, j: 0.3 }); // spine
  const lineC = P.outline ? mix(inkOf(P), P.wall, 0.6) : '#9fb7d8';
  for (let i = 0; i < 6; i++) {
    const y = -24 + i * 10;
    sk(g, P, [-56, y + d(-30), -4, y + d(-20)], { w: 1.4, c: lineC, j: 0.15 });
    sk(g, P, [4, y + d(20), 56, y + d(30)], { w: 1.4, c: lineC, j: 0.15 });
  }
  sk(g, P, [14, -32 + d(14), 14, 32 + d(14)], { w: 1.8, c: o.marginColor || CORAL, a: 0.85, j: 0.2 }); // margin line
  if (o.doodle && PROPS[o.doodle]) {
    g.save(); g.translate(36, -6 + d(36) + (o.doodleY ?? 0)); g.scale(0.38, 0.38); PROPS[o.doodle].draw(g, P, t, o.doodleOpts || {}); g.restore();
  }
  if (o.text) boxText(g, o.text, -29, d(-29), 50, 56, 13, P.outline ? inkOf(P) : '#2a2a33');
  if (o.wet) {
    const wet = clamp(o.wet === true ? 1 : o.wet);
    for (let i = 0; i < 7; i++) { const x = -52 + i * 17, k = (t * 0.5 + i * 0.37) % 1; sk(g, P, [x, -30 + k * 40, x + 1, -22 + k * 42], { w: 2.5, c: '#9fd8ff', a: wet * (1 - k), j: 0 }); }
    sk(g, P, [-62, 36, -40, 44, -20, 37, 6, 45, 30, 38, 62, 44], { w: 3, c: '#9fd8ff', a: wet * 0.7, smooth: true, j: 0.3 });
  }
}
function drawDoor(g, P, t, o, PROPS) {
  const open = clamp(o.open ?? 0);
  const c = o.color || inkOf(P);
  const hw = 46, h = 200;
  // the opening: a scene behind is visible through it
  if (open > 0) {
    g.save();
    g.beginPath(); g.rect(-hw, -h, hw * 2, h); g.clip();
    const sky = g.createLinearGradient(0, -h, 0, 0);
    sky.addColorStop(0, o.skyTop || '#101c2a'); sky.addColorStop(1, o.skyBot || '#25404a');
    g.fillStyle = sky; g.fillRect(-hw, -h, hw * 2, h);
    if (o.behind && PROPS[o.behind]) { g.save(); g.translate(0, 0); g.scale(o.behindSize ?? 0.45, o.behindSize ?? 0.45); PROPS[o.behind].draw(g, P, t, o.behindOpts || {}); g.restore(); }
    g.restore();
    if (!P.outline) glow(g, 0, -100, 170, P.key, 0.2 * open);
    else glow(g, 0, -100, 170, GOLD, 0.16 * open);
  }
  sk(g, P, [-hw, 0, -hw, -h, hw, -h, hw, 0], { w: 5.2, c, j: 0.5 });
  sk(g, P, [-hw - 8, 0, hw + 8, 0], { w: 3.4, c, a: 0.7, j: 0.5 });
  if (open < 1) { // the leaf swings on its left hinge
    const k = Math.cos(open * Math.PI * 0.46);
    const w = hw * 2 * k;
    const y0 = (1 - k) * 8;
    sk(g, P, [-hw, 0, -hw + w, y0, -hw + w, -h - y0, -hw, -h], { close: true, w: 4.5, c, fill: open > 0 ? boardOf(P) : (P.outline ? undefined : P.wood), j: 0.4 });
    ring(g, P, -hw + w - 10 * k, -96, 4.2 * k + 0.6, 4.5, { w: 3, c: GOLD, fill: GOLD, j: 0, n: 10 });
    if (w > 30) { box(g, P, -hw + w * 0.2, -184, w * 0.6, 62, { w: 2.4, c, a: 0.6, j: 0.5 }); box(g, P, -hw + w * 0.2, -104, w * 0.6, 88, { w: 2.4, c, a: 0.6, j: 0.5 }); }
  }
}
function drawChairFlat(g, P, t, o) {
  // 2D chair: no depth, thin as paper; `fold` squashes it flat under a sitter
  const k = clamp(o.fold ?? 0);
  g.scale(1 + k * 0.25, 1 - k * 0.72);
  const c = o.color || inkOf(P);
  const seat = [-34, -46, 34, -46];
  sk(g, P, [-34, -46, -34, -112, 30, -112, 34, -46], { w: 5, c, fill: true, close: true, j: 0.8, smooth: false });
  sk(g, P, seat, { w: 8, c, j: 0.8 });
  sk(g, P, [-30, -46, -32, 0], { w: 5, c, j: 0.8 });
  sk(g, P, [30, -46, 32, 0], { w: 5, c, j: 0.8 });
  for (let i = 0; i < 4; i++) sk(g, P, [-24 + i * 14, -92, -30 + i * 14, -60], { w: 1.8, c, a: 0.6, j: 1 }); // padding, badly
}
function drawArmchair(g, P) {
  const f = tint(P, GOLD, 0.25);
  sk(g, P, [-48, -12, -48, -64, -34, -112, 34, -112, 42, -64, 42, -12], { close: true, smooth: true, w: 5, fill: f });
  sk(g, P, [-54, -14, -54, -60, -36, -62, -36, -14], { close: true, w: 4.5, smooth: true, fill: f });
  sk(g, P, [36, -14, 36, -60, 54, -58, 54, -14], { close: true, w: 4.5, smooth: true, fill: f });
  sk(g, P, [-38, -38, 38, -40, 40, -14, -38, -14], { close: true, w: 4.5, fill: f });
  sk(g, P, [-40, -12, -46, 0], { w: 5 }); sk(g, P, [40, -12, 46, 0], { w: 5 });
}
function drawUmbrella(g, P, t, o) {
  const c = o.color || inkOf(P);
  const open = clamp(o.open ?? 1), lop = o.lopsided ? 1 : 0;
  sk(g, P, [0, -40, 0, 54], { w: 5, c, j: 0.3 });
  sk(g, P, [0, 54, 2, 62, -12, 62, -14, 54], { w: 5, c, smooth: true, j: 0 });
  // canopy: lopsided leans and droops on one side
  const W = lerp(6, 66, open), rise = lerp(70, 44, open);
  // lopsided: one side short and dropped, one side long and flying up, the top off-centre
  const lW = W * (1 - lop * 0.34), rW = W * (1 + lop * 0.42), lH = lop * 26 * open, rH = lop * -12 * open;
  const top = [-2 + lop * 26 * open, -40 - rise - lop * 6];
  const pts = [-lW, -40 + lH, ...top, rW, -40 + rH];
  // rib scallops along the hem
  const hem = [];
  const n = 5;
  for (let i = n; i >= 0; i--) {
    const k = i / n, x = lerp(-lW, rW, k), yb = lerp(-40 + lH, -40 + rH, k);
    hem.push(x, yb);
    if (i) hem.push(lerp(-lW, rW, k - 0.5 / n), yb - 8 * open - (lop && i === 3 ? -6 * open : 0));
  }
  sk(g, P, [-lW, -40 + lH, lerp(-lW, top[0], 0.45), lerp(-40 + lH, top[1], 0.85), ...top, lerp(rW, top[0], 0.45), lerp(-40 + rH, top[1], 0.85), rW, -40 + rH, ...hem], { w: 5, c, close: true, fill: tint(P, c === inkOf(P) ? GOLD : c, 0.4), smooth: false, j: 0.5 });
  for (let i = 1; i < n; i++) sk(g, P, [...top, lerp(-lW, rW, i / n), lerp(-40 + lH, -40 + rH, i / n) - 2], { w: 2.2, c, a: 0.6, j: 0.4 });
  void pts;
}
function drawPancakes(g, P, t, o) {
  const n = Math.round(clamp(o.count ?? 3, 1, 9));
  sk(g, P, [-62, -2, 62, -2, 48, 4, -48, 4], { close: true, w: 4, fill: true });
  const f = tint(P, '#e8c98f', 0.55);
  for (let i = 0; i < n; i++) {
    const y = -8 - i * 12, wob = (i % 2 ? 1 : -1) * 4;
    ring(g, P, wob, y, 48 - i, 7.4, { w: 4, fill: f, j: 0.3, n: 16 });
  }
  const ty = -8 - (n - 1) * 12;
  if (o.butter !== false) { sk(g, P, [-11, ty - 6, 9, ty - 8, 12, ty - 2, -8, ty], { close: true, w: 2.4, fill: tint(P, GOLD, 0.9), j: 0.1 }); }
  if (o.steam) for (let i = 0; i < 2; i++) sk(g, P, [-10 + i * 20, ty - 12, -4 + i * 20, ty - 22, -12 + i * 20, ty - 34], { w: 2.6, smooth: true, a: 0.6, j: 0 });
}
function drawCatPancake(g, P, t, o) {
  const bites = clamp(Math.round(o.bites ?? 0), 0, 2);
  sk(g, P, [-70, 42, 70, 42, 54, 50, -54, 50], { close: true, w: 4, fill: true });
  const f = tint(P, '#e8c98f', 0.55);
  // ears first (they are eaten first), then the round face
  if (bites < 2) sk(g, P, [-36, -14, -42, -48, -8, -30], { close: true, w: 4.5, fill: f });
  if (bites < 1) sk(g, P, [36, -14, 42, -48, 8, -30], { close: true, w: 4.5, fill: f });
  ring(g, P, 0, 2, 46, 36, { w: 4.5, fill: f, j: 0.4, n: 18 });
  if (bites >= 1) sk(g, P, [14, -32, 26, -22, 22, -30, 32, -18], { w: 2.8, j: 0.3 });
  if (bites >= 2) sk(g, P, [-14, -32, -26, -22, -22, -30, -32, -18], { w: 2.8, j: 0.3 });
  dot(g, inkOf(P), -15, -4, 4); dot(g, inkOf(P), 15, -4, 4);
  sk(g, P, [0, 4, -8, 12], { w: 2.6, j: 0 }); sk(g, P, [0, 4, 8, 12], { w: 2.6, j: 0 });
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) sk(g, P, [s * 26, 6 + i * 6, s * 52, 2 + i * 10], { w: 2.2, j: 0.2 });
}
function drawCereal(g, P, t, o, PROPS, boxText) {
  const f = tint(P, '#ffc76a', 0.45);
  box(g, P, -46, -150, 92, 150, { w: 5, fill: f, j: 0.5 });
  sk(g, P, [-46, -150, -36, -158, 56, -158, 46, -150], { w: 4.5, fill: tint(P, '#ffc76a', 0.25), close: true, j: 0.4 });
  sk(g, P, [46, -150, 56, -158, 56, -8, 46, 0], { w: 4.5, fill: tint(P, '#ffc76a', 0.2), close: true, j: 0.4 });
  boxText(g, o.text || 'CRUNCHY O\'S', 0, -130, 84, 28, 15, P.outline ? inkOf(P) : '#2a2a33', 800);
  ring(g, P, 0, -92, 26, 11, { w: 3, n: 14, j: 0.3 });
  for (let i = 0; i < 5; i++) ring(g, P, -16 + i * 8, -98 + (i % 2) * 5, 3.5, 3, { w: 2, n: 8, j: 0 });
  if (o.bike !== false) { g.save(); g.translate(0, -18); g.scale(0.62, 0.62); drawBike(g, P, t, { oval: o.oval ?? true }); g.restore(); }
}
function drawStencil(g, P, t, o) {
  const c = o.color || '#b86a4a';
  if (o.spray !== false) {
    const r = rng(7);
    g.fillStyle = css(c, 0.3);
    g.fillStyle = css(c, 0.55);
    for (let i = 0; i < 520; i++) { const a = r() * TAU, d = 26 + r() * 50; const x = Math.cos(a) * d, y = Math.sin(a) * d * 1.25 - 6; g.fillRect(x, y, 2.6, 2.6); }
    glow(g, 0, -6, 96, c, 0.72);
  }
  // the negative: the hand in rock colour, outlined by the pigment
  const hand = [-22, 44, -26, 16, -46, -6, -40, -12, -22, 4, -24, -46, -16, -48, -11, -8, -8, -60, 0, -60, 2, -8, 11, -52, 18, -50, 13, -4, 24, -36, 31, -32, 22, 16, 22, 44];
  sk(g, P, hand, { close: true, w: 1.5, c: css(c, 0.8), fill: o.rock || (P.outline ? mix(P.wall, '#000000', 0.25) : P.rock), j: 0.8, smooth: false });
}
function drawPhoneUI(g, P, t, o, boxText) {
  const c = inkOf(P);
  sk(g, P, [-52, -96, 52, -96, 52, 96, -52, 96], { close: true, w: 5, fill: true, j: 0.3 });
  box(g, P, -45, -86, 90, 172, { w: 2, fill: P.outline ? mix(boardOf(P), '#000000', 0.2) : P.screen, j: 0.2 });
  // live badge and viewers
  if (o.live !== false) {
    box(g, P, -40, -80, 30, 14, { w: 0, fill: CORAL, j: 0 });
    boxText(g, 'LIVE', -25, -73, 30, 14, 10, '#23221f', 800);
    if (o.viewers != null) boxText(g, `${o.viewers}`, 15, -73, 46, 14, 11, c, 700);
  }
  // main picture: a small chalk scene slot
  sk(g, P, [-40, -60, 40, -60, 40, 30, -40, 30], { close: true, w: 2, c, a: 0.5, j: 0.2 });
  if (o.text) boxText(g, o.text, 0, -18, 76, 80, 16, c, 800);
  const big = o.views != null ? o.views : o.value;
  if (big != null) boxText(g, `${big}`, 0, 44, 80, 22, 18, GOLD, 800);
  if (o.label) boxText(g, o.label, 0, 62, 80, 14, 10, c, 700);
  if (o.followers != null) boxText(g, `${o.followers} FOLLOWERS`, 0, 76, 84, 13, 9, c, 700);
  if (o.money) for (let i = 0; i < 4; i++) { const k = (t * 0.7 + i * 0.25) % 1; boxText(g, '$', -28 + i * 18, 18 - k * 50, 16, 18, 16, GOLD, 800); }
  if (o.hearts !== false) for (let i = 0; i < 3; i++) { const k = (t * 0.5 + i * 0.33) % 1; dot(g, CORAL, 36 + Math.sin(i + t * 2) * 3, 26 - k * 70, 3 * (1 - k * 0.5)); }
}

// Every prop in this module: a table merged into the prop library.
export function drawnProps(PROPS, h) {
  const { boxText } = h;
  const stroke = (fn) => fn;
  return {
    dog: { ground: true, speed: 240, draw(g, P, t, o) { drawDog(g, P, t, o, o.legs === 3); } },
    tripod: { ground: true, speed: 210, draw(g, P, t, o) { drawDog(g, P, t, { ...o, fluffy: o.fluffy ?? true }, true); } },
    hand: { ground: false, h: 180, draw(g, P, t, o) { drawHandProp(g, P, t, o); } },
    // a plain polyline in stage fractions: points: [[x, y], ...], or lines: [[[x, y], ...], ...] for several strokes
    line: { ground: false, h: 100, draw(g, P, t, o) { drawLineProp(g, P, t, o); } },
    // soft light with no shape: {x, y, radius (stage px), color, alpha}
    glow: { ground: false, h: 200, draw(g, P, t, o) {
      const c = o.color || P.key || '#ffd9a0', r = num(o.radius, 220) / (o._size || 1), a = clamp(num(o.strength, 0.55));
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
      gr.addColorStop(0, css(c, a)); gr.addColorStop(0.45, css(c, a * 0.45)); gr.addColorStop(1, css(c, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    } },
    bike: { k: 1.3, ground: true, speed: 240, draw(g, P, t, o) { drawBike(g, P, t, o); } },
    bird: { ground: false, h: 50, speed: 340, draw: birdDraw(null) },
    gull: { ground: false, h: 50, speed: 340, draw: birdDraw('gull') },
    swallow: { ground: false, h: 45, speed: 380, draw: birdDraw('swallow') },
    heron: { ground: false, h: 70, speed: 300, draw: birdDraw('heron') },
    // many birds: on the ground as chalk (flat 1), then lifting and circling (flat 0, rise 0..1)
    flock: { ground: false, h: 300, draw(g, P, t, o) {
      const n = clamp(Math.round(o.count ?? 60), 1, 300), r = rng(11);
      const flat = clamp(o.flat ?? 0), rise = clamp(o.rise ?? 0);
      const w = o.w ?? 420, hh = o.h ?? 180;
      for (let i = 0; i < n; i++) {
        const fx = r() * 2 - 1, fy = r() * 2 - 1, ph = r() * TAU, kind = r() < 0.72 ? 'gull' : r() < 0.86 ? 'swallow' : 'heron', sc = 0.34 + r() * 0.26;
        const delay = clamp(r() * 0.5);
        const k = smooth((rise - delay) / (1 - delay));
        const a = t * 0.5 * (1 + r() * 0.3) + ph;
        const fly = { x: Math.cos(a) * w * 0.8 * (0.3 + 0.7 * Math.abs(fx)), y: -hh * 1.3 + Math.sin(a * 1.4) * hh * 0.7 * Math.abs(fy) };
        const x = lerp(fx * w, fly.x, k), y = lerp(fy * hh * 0.5, fly.y, k);
        g.save(); g.translate(x, y); g.scale(sc * (Math.cos(a + 1.57) > 0 && k > 0.4 ? -1 : 1), sc);
        bird(g, P, kind, Math.max(flat * (1 - k), k < 0.05 ? 1 : 0), t * 13 + ph, { color: o.color });
        g.restore();
      }
    } },
    sandwich: { ground: false, h: 50, draw(g, P, t, o) { drawSandwich(g, P, t, o); } },
    notebook: { ground: false, h: 70, draw(g, P, t, o) { drawNotebook(g, P, t, o, PROPS, boxText); } },
    page: { ground: false, h: 110, draw(g, P, t, o) {
      if (o.glow) glow(g, 0, 0, 170, o.glowColor || '#fff5c0', 0.5 * o.glow);
      sk(g, P, [-52, -68, 52, -68, 52, 68, -52, 68], { close: true, w: 4, fill: P.outline ? mix(boardOf(P), '#f6f4e6', o.glow ? 0.24 : 0.14) : '#f6f4ee', j: 0.4 });
      if (o.wet) { const wet = clamp(o.wet === true ? 1 : o.wet); for (let i = 0; i < 7; i++) { const x = -44 + i * 15, k = (t * 0.45 + i * 0.33) % 1; sk(g, P, [x, -60 + k * 90, x + 1, -50 + k * 94], { w: 2.5, c: '#9fd8ff', a: wet * (1 - k), j: 0 }); } }
      if (o.text) boxText(g, o.text, 0, 0, 96, 124, 28, P.outline ? inkOf(P) : '#2a2a33', 800);
    } },
    // the simplest person: circle, line, two arms, two legs, each a single stroke
    stickman: { ground: false, h: 150, draw(g, P, t, o) {
      const c = o.color || inkOf(P), w = o.w ?? 5;
      ring(g, P, 0, -48, 18, 18, { w, c, n: 22, j: 0.5, seed: 1 });
      sk(g, P, [0, -30, 0, 22], { w, c, j: 0.5 });
      sk(g, P, [0, -16, -32, 6], { w, c, j: 0.5 }); sk(g, P, [0, -16, 32, 6], { w, c, j: 0.5 });
      sk(g, P, [0, 22, -24, 66], { w, c, j: 0.5 }); sk(g, P, [0, 22, 24, 66], { w, c, j: 0.5 });
    } },
    // a badly drawn person: limbs of the wrong number and the wrong length; never gory
    wrongfigure: { ground: true, draw(g, P, t, o) {
      const c = o.color || CORAL, w = 5;
      const q = Math.sin(t * 14) * 2;
      ring(g, P, 12 + q, -218, 34, 22, { w, c, j: 1.2, n: 14 });
      sk(g, P, [8, -196, -14, -70], { w, c, j: 1.2 });
      sk(g, P, [-4, -170, -92, -90, -70, -40], { w, c, j: 1.5 });
      sk(g, P, [-4, -162, 70, -210], { w, c, j: 1.5 });
      sk(g, P, [-8, -130, 66, -96, 86, -130], { w, c, j: 1.5 });
      sk(g, P, [-14, -70, -60, 0], { w, c, j: 1.5 });
      sk(g, P, [-14, -70, 2, -30, 34, 0], { w, c, j: 1.5 });
    } },
    pencil: { ground: false, h: 60, draw(g, P, t, o) {
      g.save(); g.rotate(-0.6);
      const f = tint(P, o.color || GOLD, 0.85);
      sk(g, P, [-8, -40, 8, -40, 8, 16, -8, 16], { close: true, w: 3.4, fill: f, j: 0.3 });
      sk(g, P, [-3, -40, -3, 16], { w: 1.6, a: 0.5, j: 0.2 }); sk(g, P, [3, -40, 3, 16], { w: 1.6, a: 0.5, j: 0.2 });
      sk(g, P, [-8, -40, -8, -52, 8, -52, 8, -40], { close: true, w: 3, fill: tint(P, '#ffb0a0', 0.65), j: 0.2 });
      sk(g, P, [-8, 16, 0, 36, 8, 16], { close: true, w: 3, fill: tint(P, '#e8d6b0', 0.65), j: 0.1 });
      dot(g, inkOf(P), 0, 33, 2.6);
      g.restore();
    } },
    pen: { ground: false, h: 60, draw(g, P, t, o) {
      g.save(); g.rotate(-0.6);
      const f = tint(P, o.color || '#9fd8ff', 0.5);
      sk(g, P, [-6.5, -48, 6.5, -48, 6.5, 10, -6.5, 10], { close: true, w: 3.2, fill: f, j: 0.2 });
      sk(g, P, [6.5, -48, 10, -48, 10, -22], { w: 2.6, j: 0.1 }); // clip
      sk(g, P, [-6.5, 10, 0, 32, 6.5, 10], { close: true, w: 3, fill: true, j: 0.1 });
      dot(g, inkOf(P), 0, 30, 2);
      g.restore();
    } },
    chalk: { ground: false, h: 50, draw(g, P, t, o) {
      g.save(); g.rotate(-0.6);
      sk(g, P, [-8, -30, 8, -30, 9, 26, -7, 28], { close: true, w: 2.4, c: '#d8d8c8', fill: o.color || '#fbfbf2', j: 0.5 });
      sk(g, P, [-5, 18, 4, 20], { w: 2, c: '#c8c8b8', j: 0.5 });
      g.restore();
    } },
    eraser: { ground: false, h: 50, draw(g, P, t, o) {
      const f = tint(P, '#ffb0a0', 0.55);
      sk(g, P, [-44, -12, 36, -12, 48, 14, -32, 14], { close: true, w: 4, fill: f, j: 0.4 });
      sk(g, P, [-14, -12, -2, 14], { w: 3, j: 0.2 });
      sk(g, P, [-44, -12, -32, 14], { w: 3, j: 0.2 });
      boxText(g, o.text || 'RUBBER', 16, 1, 42, 18, 11, P.outline ? inkOf(P) : '#2a2a33', 800);
      if (o.worn) sk(g, P, [28, 14, 48, 14, 44, 4], { w: 2, c: faint(P), j: 0.3 });
    } },
    shavings: { ground: true, draw(g, P, t, o) {
      const n = Math.round(clamp(o.count ?? 12, 1, 40)), r = rng(5);
      for (let i = 0; i < n; i++) {
        const x = (r() - 0.5) * (o.w ?? 90), y = -r() * 6 - 2, a = r() * TAU;
        g.save(); g.translate(x, y); g.rotate(a);
        sk(g, P, [-10, 0, -3, -5, 3, 3, 10, -2], { w: 3.4, c: o.color || tint(P, '#ffb0a0', 0.8), smooth: true, j: 0 });
        g.restore();
      }
    } },
    umbrella: { ground: false, h: 100, grip: [0, 46], draw(g, P, t, o) { drawUmbrella(g, P, t, o); } },
    plate: { ground: true, draw(g, P) { sk(g, P, [-62, -6, 62, -6, 46, 2, -46, 2], { close: true, w: 4, fill: true }); sk(g, P, [-40, -6, 40, -6], { w: 2, a: 0.5 }); } },
    plates: { ground: true, draw(g, P, t, o) {
      const n = Math.round(clamp(o.count ?? 6, 1, 30));
      for (let i = 0; i < n; i++) sk(g, P, [-50, -5 - i * 7, 50, -5 - i * 7, 42, -i * 7, -42, -i * 7], { close: true, w: 3.4, fill: true, seed: i });
    } },
    pancakes: { ground: true, draw(g, P, t, o) { drawPancakes(g, P, t, o); } },
    catpancake: { ground: false, h: 90, draw(g, P, t, o) { drawCatPancake(g, P, t, o); } },
    cereal: { ground: true, draw(g, P, t, o) { drawCereal(g, P, t, o, PROPS, boxText); } },
    chair: { ground: true, draw(g, P) {
      const f = tint(P, '#c89a5a', 0.35);
      sk(g, P, [-28, -48, 26, -48, 34, -38, -20, -38], { close: true, w: 4.4, fill: f });
      sk(g, P, [-28, -48, -32, -106, -20, -108, -18, -48], { close: true, w: 4.2, fill: f });
      sk(g, P, [-24, -38, -26, 0], { w: 4.6 }); sk(g, P, [-10, -38, -11, -7], { w: 3.4, c: faint(P) });
      sk(g, P, [28, -38, 30, 0], { w: 4.6 }); sk(g, P, [14, -38, 13, -7], { w: 3.4, c: faint(P) });
    } },
    flatchair: { ground: true, draw(g, P, t, o) { drawChairFlat(g, P, t, o); } },
    armchair: { ground: true, draw(g, P) { drawArmchair(g, P); } },
    door: { k: 1.15, ground: true, draw(g, P, t, o) { drawDoor(g, P, t, o, PROPS); } },
    // a hilltop with a red-lit radio mast and the city glittering below
    masthill: { k: 1.6, ground: true, draw(g, P, t, o) {
      const c = inkOf(P);
      if (o.city !== false) {
        const r = rng(3);
        for (let i = 0; i < 70; i++) { const x = (r() - 0.5) * 460, y = -r() * 34 + 4, b = 0.4 + 0.6 * Math.abs(Math.sin(t * (1 + r()) + i)); dot(g, css(r() < 0.3 ? GOLD : '#fbfbf2', b), x, y, 1.2 + r() * 1.3); }
      }
      sk(g, P, [-230, 0, -130, -36, -40, -76, 30, -86, 110, -56, 230, 0], { w: 5, c, fill: true, smooth: true, close: true, j: 0.6 });
      // mast
      sk(g, P, [8, -86, 12, -280], { w: 4, c, j: 0.3 }); sk(g, P, [30, -86, 12, -280], { w: 3.4, c, j: 0.3 }); sk(g, P, [-14, -82, 12, -280], { w: 3.4, c, j: 0.3 });
      for (let i = 1; i < 6; i++) { const y = -86 - i * 32, s = 1 - i / 6; sk(g, P, [12 - 26 * s, y, 12 + 18 * s + 2, y + 2], { w: 2.4, c, j: 0.3 }); }
      const on = Math.sin(t * 4) > -0.3;
      dot(g, on ? CORAL : mix(CORAL, '#000000', 0.5), 12, -284, 5);
      if (on) glow(g, 12, -284, 34, CORAL, 0.6);
      for (let i = 0; i < 12; i++) { const x = -110 + i * 20; sk(g, P, [x, -40 - Math.abs(Math.sin(i * 2.3)) * 34, x + 3, -48 - Math.abs(Math.sin(i * 2.3)) * 34], { w: 2.2, c, a: 0.6, j: 0.5 }); }
    } },
    mast: { ground: true, draw(g, P, t) {
      const c = inkOf(P);
      sk(g, P, [-20, 0, 0, -220, 20, 0], { w: 4, c, j: 0.4 });
      for (let i = 1; i < 6; i++) { const y = -i * 36, s = 1 - i / 6.1; sk(g, P, [-20 * s, y, 20 * s, y], { w: 2.6, c, j: 0.3 }); }
      const on = Math.sin(t * 4) > -0.3;
      dot(g, on ? CORAL : mix(CORAL, '#000000', 0.5), 0, -224, 5);
      if (on) glow(g, 0, -224, 30, CORAL, 0.6);
    } },
    // ---------- harbor ----------
    boardwalk: { k: 1.6, ground: true, draw(g, P, t, o) {
      const n = o.planks ?? 24, w = o.w ?? 400, c = faint(P);
      sk(g, P, [-w, -4, w, -4, w, 40, -w, 40], { w: 0, close: true, fill: P.outline ? mix(boardOf(P), P.wood, 0.2) : P.wood });
      sk(g, P, [-w, -4, w, -4], { w: 4, c: inkOf(P), j: 0.8 });
      for (let i = 0; i <= n; i++) { const x = -w + (i * 2 * w) / n; sk(g, P, [x, -3, x * 1.08, 40], { w: 2, c, j: 0.8, seed: i }); }
    } },
    railing: { k: 1.6, ground: true, draw(g, P, t, o) {
      const w = o.w ?? 400, n = o.posts ?? 12, c = inkOf(P);
      sk(g, P, [-w, -64, w, -64], { w: 4.2, c, j: 0.9 }); sk(g, P, [-w, -38, w, -38], { w: 3, c, a: 0.7, j: 0.8 });
      for (let i = 0; i <= n; i++) { const x = -w + (i * 2 * w) / n; sk(g, P, [x, -66, x, 0], { w: 3.6, c, j: 0.5, seed: i }); }
    } },
    barrier: { k: 1.6, ground: true, draw(g, P, t, o) {
      const w = o.w ?? 200, n = o.posts ?? 4;
      for (let i = 0; i <= n; i++) { const x = -w + (i * 2 * w) / n; sk(g, P, [x, -44, x, 0], { w: 4, j: 0.3, seed: i }); dot(g, inkOf(P), x, -46, 3.4); if (i < n) { const x2 = x + (2 * w) / n; sk(g, P, [x, -40, (x + x2) / 2, -24, x2, -40], { w: 3.2, c: o.ropeColor || tint(P, CORAL, 0.8), smooth: true, j: 0.2, seed: i }); } }
    } },
    // a crowd of silhouettes; turn 0..1 turns heads toward the viewer, cheer raises arms
    crowd: { k: 1, ground: true, draw(g, P, t, o) {
      const n = Math.round(clamp(o.count ?? 18, 1, 60)), w = o.w ?? 460, r = rng(9);
      const c = o.color || mix(inkOf(P), P.wall, 0.45);
      const turn = clamp(o.turn ?? 0), cheer = clamp(o.cheer ?? 0);
      for (let i = 0; i < n; i++) {
        const x = -w + (i + 0.5) / n * 2 * w + (r() - 0.5) * 16, sz = 0.72 + r() * 0.24, row = r() < 0.5 ? 0 : -16;
        const ph = r() * TAU;
        const hy = (-158 + row) * sz + Math.sin(t * 2 + ph) * 1.4;
        sk(g, P, [x, row, x, hy + 22 * sz], { w: 22 * sz, c, j: 0.2, seed: i });
        const up = cheer * (0.6 + 0.4 * Math.sin(t * 6 + ph));
        for (const s of [-1, 1]) sk(g, P, [x, hy + 30 * sz, x + s * lerp(10, 22, up) * sz, lerp(hy + 62 * sz, hy - 18 * sz, up)], { w: 9 * sz, c, j: 0.2, seed: i });
        dot(g, c, x, hy, 18 * sz);
        if (turn > 0.02) { const fx = lerp(-5, 0, turn) * sz; g.fillStyle = css(P.outline ? boardOf(P) : '#000000', turn); circle(g, x + fx - 5 * sz, hy - 1, 2 * sz); g.fill(); circle(g, x + fx + 5 * sz, hy - 1, 2 * sz); g.fill(); }
      }
    } },
    banner: { ground: false, h: 80, draw(g, P, t, o) {
      const c = inkOf(P);
      const wv = Math.sin(t * 2) * 2;
      sk(g, P, [-150, -28, -50, -28 + wv, 50, -28 - wv, 150, -28, 150, 28, 50, 28 - wv, -50, 28 + wv, -150, 28], { close: true, w: 4.5, fill: tint(P, GOLD, 0.2) });
      sk(g, P, [-150, -28, -168, -60], { w: 3, c }); sk(g, P, [150, -28, 168, -60], { w: 3, c });
      if (o.text) boxText(g, o.text, 0, 0, 290, 52, 30, P.outline ? c : '#2a2a33', 800);
    } },
    waves: { k: 1, ground: true, draw(g, P, t, o) {
      const w = o.w ?? 620, h = o.size0 ?? 54, amp = o.rough ?? 1;
      for (let k = 2; k >= 0; k--) {
        const pts = [];
        for (let i = 0; i <= 28; i++) { const x = -w + (i * 2 * w) / 28; pts.push(x, -k * 18 - Math.abs(Math.sin(i * 0.55 + t * 1.8 + k)) * h * amp * (1 - k * 0.2)); }
        pts.push(w, 18, -w, 18);
        sk(g, P, pts, { w: 3.4, close: true, c: mix(inkOf(P), P.water, 0.35), fill: css(P.water, 0.85), smooth: false, j: 0.6, seed: k });
      }
      if (o.spray) for (let i = 0; i < 10; i++) { const k = (t * 0.8 + i * 0.1) % 1, x = -w * 0.8 + i * w * 0.18; dot(g, css(inkOf(P), 1 - k), x + Math.sin(i) * 12, -h - k * 90, 2.4); }
    } },
    // ---------- creek and bridge ----------
    footbridge: { k: 1.6, ground: true, dip: true, gapped: true, draw(g, P, t, o) { drawFootbridge(g, P, t, o); } },
    creek: { k: 1, ground: true, draw(g, P, t, o) { drawCreek(g, P, t, o); } },
    // a taped-up sign on a post
    donotcross: { ground: true, draw(g, P, t, o) {
      const c = inkOf(P);
      sk(g, P, [0, 0, 0, -90], { w: 6, c, j: 0.6 });
      g.save(); g.translate(0, -112); g.rotate(-0.03);
      sk(g, P, [-62, -30, 62, -30, 62, 30, -62, 30], { close: true, w: 4, fill: tint(P, '#e8d6a0', 0.3), j: 0.8 });
      boxText(g, o.text || 'DO NOT\nCROSS', 0, 0, 118, 56, 26, P.outline ? CORAL : '#b52f22', 800);
      // tape
      for (const [x, y, a] of [[-54, -28, 0.6], [54, -28, -0.6], [-54, 28, -0.6], [54, 28, 0.6]]) { g.save(); g.translate(x, y); g.rotate(a); sk(g, P, [-14, 0, 14, 0], { w: 7, c: tint(P, GOLD, 0.55), j: 0.2 }); g.restore(); }
      g.restore();
    } },
    // prints across the ground: kind boot | paw3 | paw. count may be tweened to lay them down.
    prints: { ground: true, draw(g, P, t, o) {
      const n = clamp(Math.round(o.count ?? 8), 0, 40), gap = o.spacing ?? 34, kind = o.kind || 'boot', c = o.color || inkOf(P);
      const bootP = (x, y) => { ring(g, P, x, y - 3, 8, 3.2, { w: 2.6, c, j: 0.3, n: 10 }); sk(g, P, [x - 5, y + 1, x - 11, y + 1], { w: 3, c, j: 0.2 }); };
      const soleP = (x, y) => { ring(g, P, x + 3.5, y - 3, 7.5, 3.6, { w: 0, fill: c, j: 0, n: 10 }); ring(g, P, x - 8, y - 3, 3.6, 3, { w: 0, fill: c, j: 0, n: 8 }); };
      const pawP = (x, y) => { ring(g, P, x, y, 4.2, 2.8, { w: 0, fill: c, j: 0, n: 8 }); for (let i = -1; i <= 1; i++) dot(g, c, x + i * 4.2, y - 4 - (i === 0 ? 1 : 0), 1.5); };
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * gap;
        if (kind === 'boot') bootP(x, i % 2 ? 0 : -9);
        else if (kind === 'sole') soleP(x, i % 2 ? 0 : -9);
        else if (kind === 'paw') pawP(x, i % 2 ? 2 : -9);
        else { const k = i % 3; pawP(x, k === 2 ? -11 : k === 0 ? 2 : -6); } // three feet: a broken rhythm of front pair and hop
      }
    } },
    // ---------- cave ----------
    stencil: { ground: false, h: 130, draw(g, P, t, o) { drawStencil(g, P, t, o); } },
    cavewall: { k: 2, ground: true, draw(g, P, t, o) {
      const c = P.outline ? mix(P.wall, '#000000', 0.25) : P.rock;
      sk(g, P, [-270, 0, -260, -220, -180, -280, -40, -300, 120, -282, 250, -240, 276, 0], { close: true, smooth: true, w: 4, c: faint(P), fill: c, j: 1.5 });
      const r = rng(3);
      for (let i = 0; i < 14; i++) sk(g, P, [(r() - 0.5) * 480, -r() * 250, (r() - 0.5) * 480, -r() * 250], { w: 1.6, c: faint(P), a: 0.3, j: 2 });
    } },
    // ---------- paper and money ----------
    contract: { ground: false, h: 150, draw(g, P, t, o) {
      const un = clamp(o.unroll ?? 1), h = lerp(16, 150, un), paper = P.outline ? mix(boardOf(P), '#f6f4e6', 0.14) : '#f6f4ee';
      sk(g, P, [-74, -74, 74, -74, 74, -74 + h, -74, -74 + h], { close: true, w: 4, fill: paper, j: 0.5 });
      ring(g, P, 0, -74 + h, 80, 8, { w: 3.5, fill: paper, n: 14, j: 0.2 });
      ring(g, P, 0, -74, 80, 8, { w: 3.5, fill: paper, n: 14, j: 0.2 });
      if (un > 0.6) {
        const a = (un - 0.6) / 0.4;
        g.save(); g.globalAlpha *= a;
        if (o.text) boxText(g, o.text, 0, -44, 130, 34, 22, P.outline ? inkOf(P) : '#2a2a33', 800);
        const n = o.slots ?? 3;
        for (let i = 0; i < n; i++) { const y = -10 + i * 26; boxText(g, `${i + 1}.`, -56, y, 22, 22, 15, P.outline ? inkOf(P) : '#2a2a33', 700); sk(g, P, [-42, y + 6, 58, y + 6], { w: 2.4, c: faint(P), j: 0.6 }); }
        g.restore();
      }
    } },
    bill: { ground: false, h: 110, draw(g, P, t, o) {
      const k = clamp(o.print ?? 1), H = lerp(10, 120, k), paper = P.outline ? mix(boardOf(P), '#f6f4e6', 0.14) : '#f6f4ee';
      const pts = [-38, -60, 38, -60, 38, -60 + H];
      for (let i = 0; i <= 8; i++) pts.push(38 - i * 9.5, -60 + H + (i % 2 ? 5 : 0));
      sk(g, P, pts, { close: true, w: 3.6, fill: paper, j: 0.3 });
      if (o.text && k > 0.5) boxText(g, o.text, 0, -60 + H / 2, 70, H * 0.9, 18, P.outline ? inkOf(P) : '#2a2a33', 700);
      else if (k > 0.5) for (let i = 0; i < 5; i++) sk(g, P, [-28, -46 + i * 14, 14 + (i % 2) * 12, -46 + i * 14], { w: 2.2, c: faint(P), j: 0.4 });
    } },
    banknote: { ground: false, h: 60, draw(g, P, t, o) {
      const c = o.wobbly === false ? inkOf(P) : inkOf(P);
      sk(g, P, [-62, -28, 60, -32, 66, 26, -58, 30], { close: true, w: 4, c, fill: tint(P, '#8fd08a', 0.35), j: o.wobbly === false ? 0.3 : 1.8 });
      ring(g, P, 2, -1, 16, 18, { w: 3, c, n: 11, j: o.wobbly === false ? 0.2 : 1.8 });
      boxText(g, o.text || '$', 2, 0, 26, 28, 22, P.outline ? inkOf(P) : '#2a2a33', 800);
      for (const [x, y] of [[-50, -18], [50, -20], [-48, 18], [52, 16]]) boxText(g, '1', x, y, 18, 16, 13, P.outline ? inkOf(P) : '#2a2a33', 700);
    } },
    wallet: { ground: false, h: 60, draw(g, P, t, o) {
      const f = tint(P, '#c89a5a', 0.4);
      sk(g, P, [-44, -26, 44, -26, 46, 26, -46, 26], { close: true, w: 4.5, fill: f, smooth: false });
      sk(g, P, [-44, -8, 44, -8], { w: 2.4, a: 0.6 });
      sk(g, P, [14, -4, 46, -4, 46, 12, 14, 12], { close: true, w: 3.2 }); dot(g, GOLD, 22, 4, 3);
      if (o.empty) { sk(g, P, [-48, 26, -66, 40], { w: 2, c: faint(P) }); dot(g, faint(P), -70, 44, 2.4); }
    } },
    cheque: { ground: false, h: 70, draw(g, P, t, o) {
      sk(g, P, [-110, -36, 110, -36, 110, 36, -110, 36], { close: true, w: 4, fill: tint(P, '#8fd08a', 0.25) });
      boxText(g, o.text || '$2,000', 28, -2, 150, 40, 32, P.outline ? GOLD : '#2a2a33', 800);
      sk(g, P, [-98, -18, -40, -18], { w: 2.2, c: faint(P) }); sk(g, P, [-98, 22, -30, 22], { w: 2.2, c: faint(P) });
      sk(g, P, [38, 24, 70, 17, 58, 26, 96, 20], { w: 2.4, smooth: true, j: 0.8 });
    } },
    nametag: { ground: false, h: 40, draw(g, P, t, o) {
      sk(g, P, [-10, -24, 0, -32, 10, -24], { w: 3 });
      ring(g, P, 0, 0, 34, 24, { w: 4, fill: tint(P, GOLD, 0.5), n: 16 });
      boxText(g, o.text || 'TRIPOD', 0, 1, 58, 34, 18, P.outline ? inkOf(P) : '#2a2a33', 800);
    } },
    // ---------- science and screens ----------
    // a balance: tilt -1..1, weights named by leftText / rightText
    balance: { ground: true, draw(g, P, t, o) {
      const c = inkOf(P), tilt = (o.tilt ?? 0) * 0.28;
      sk(g, P, [-40, 0, 40, 0], { w: 5, c }); sk(g, P, [0, 0, 0, -140], { w: 5, c });
      dot(g, GOLD, 0, -142, 5);
      g.save(); g.translate(0, -140); g.rotate(tilt);
      sk(g, P, [-100, 0, 100, 0], { w: 5, c });
      for (const s of [-1, 1]) {
        const px = s * 100;
        g.save(); g.translate(px, 0); g.rotate(-tilt);
        sk(g, P, [0, 0, -34, 64], { w: 2.4, c }); sk(g, P, [0, 0, 34, 64], { w: 2.4, c });
        sk(g, P, [-38, 64, 38, 64, 28, 74, -28, 74], { close: true, w: 4, c, fill: true });
        const it = s < 0 ? o.left : o.right, tx = s < 0 ? o.leftText : o.rightText;
        if (it && PROPS[it]) { g.save(); g.translate(0, 48); g.scale(0.42, 0.42); PROPS[it].draw(g, P, t, {}); g.restore(); }
        if (tx) boxText(g, tx, 0, 46, 66, 28, 16, c, 800);
        g.restore();
      }
      g.restore();
    } },
    // a kitchen scale with a readout
    scales: { ground: true, draw(g, P, t, o, ) {
      const c = inkOf(P);
      sk(g, P, [-58, 0, -48, -46, 48, -46, 58, 0], { close: true, w: 4.5, fill: true });
      box(g, P, -34, -36, 68, 26, { w: 3, c, fill: P.outline ? mix(boardOf(P), '#000000', 0.25) : P.screen });
      boxText(g, o.text || '200 G', 0, -23, 64, 24, 18, GOLD, 800);
      sk(g, P, [-62, -54, 62, -54, 50, -46, -50, -46], { close: true, w: 4, fill: true });
      if (o.on && PROPS[o.on]) { g.save(); g.translate(0, -54 - (PROPS[o.on].ground ? 0 : 26)); g.scale(0.7, 0.7); PROPS[o.on].draw(g, P, t, o.onOpts || {}); g.restore(); }
    } },
    // horizon, vanishing point and rails that converge as `grow` goes 0..1
    perspective: { ground: false, h: 240, draw(g, P, t, o) {
      const c = inkOf(P), w = 240, hz = -30, vp = { x: o.vx ?? 0, y: hz }, k = clamp(o.grow ?? 1), n = o.rails ?? 6;
      sk(g, P, [-w, hz, w, hz], { w: 3, c, a: 0.8, j: 0.6 });
      if (k > 0) for (let i = 0; i < n; i++) {
        const sx = -w + (i * 2 * w) / (n - 1), sy = 110;
        sk(g, P, [sx, sy, lerp(sx, vp.x, k), lerp(sy, vp.y, k)], { w: 2.6, c: i % 2 ? c : GOLD, a: 0.85, j: 0.4, seed: i });
      }
      dot(g, CORAL, vp.x, vp.y, 6);
    } },
    // a flat square that gains depth, depth 0..1, optionally toward vanishing point vx, vy
    depthbox: { ground: false, h: 120, draw(g, P, t, o) {
      const d = clamp(o.depth ?? 1), c = inkOf(P), s = 56, x = -36, y = -20;
      const vx = o.vx ?? 150, vy = o.vy ?? -130, k = 0.45 * d;
      const B = (px, py) => [lerp(px, vx, k), lerp(py, vy, k)];
      if (d > 0) {
        const [a, b] = B(x + s, y), [e, f] = B(x + s, y + s), [m, n] = B(x, y);
        sk(g, P, [x, y, x + s, y, a, b, m, n], { close: true, w: 4, c, fill: tint(P, GOLD, 0.25), j: 0.3 });
        sk(g, P, [x + s, y, a, b, e, f, x + s, y + s], { close: true, w: 4, c, fill: tint(P, GOLD, 0.15), j: 0.3 });
      }
      sk(g, P, [x, y, x + s, y, x + s, y + s, x, y + s], { close: true, w: 4.4, c, fill: tint(P, GOLD, 0.35), j: 0.3 });
    } },
    pen3d: { ground: true, draw(g, P, t, o) {
      const c = inkOf(P), g0 = clamp(o.grow ?? 1), H = g0 * 150;
      // plastic tower of hardened strands
      const r = rng(12);
      for (let i = 0; i < 22 * g0; i++) {
        const y = -6 - (i * 150) / 22, w = 40 * (1 - i / 34), s = i % 2 ? 1 : -1;
        sk(g, P, [-w * s, y, -w * 0.3 * s, y - 2, w * 0.2 * s, y + 2, w * s, y - 1], { w: 3.4, c: tint(P, '#9fd8ff', 0.8), smooth: true, j: 0.6, seed: i });
      }
      sk(g, P, [-44, 0, 44, 0], { w: 3.4, c, a: 0.7 });
      void r;
      // the pen on top, squeezing out a hot strand
      g.save(); g.translate(0, -H - 6); g.rotate(-0.55);
      sk(g, P, [0, 0, 0, -24], { w: 3, c: GOLD, j: 0.5 });
      sk(g, P, [-11, -24, 11, -24, 14, -96, -14, -96], { close: true, w: 4, c, fill: true, j: 0.3 });
      sk(g, P, [-11, -24, 0, -8, 11, -24], { close: true, w: 3, c, fill: true, j: 0.2 });
      box(g, P, -7, -80, 14, 10, { w: 2.4, c, fill: tint(P, CORAL, 0.6), j: 0.2 });
      g.restore();
    } },
    phonestream: { ground: false, h: 190, draw(g, P, t, o) { drawPhoneUI(g, P, t, o, boxText); } },
    bigscreen: { k: 1.6, ground: true, draw(g, P, t, o) {
      const c = inkOf(P), W = 150, H0 = 170, H = 92;
      sk(g, P, [-90, 0, -90, -H0 + 90], { w: 5, c, j: 0.4 }); sk(g, P, [90, 0, 90, -H0 + 90], { w: 5, c, j: 0.4 });
      const y = -H0 - H / 2 + 40;
      sk(g, P, [-W, y - H, W, y - H, W, y + H, -W, y + H], { close: true, w: 5, c, fill: P.outline ? mix(boardOf(P), '#000000', 0.42) : P.propDark, j: 0.5 });
      g.save();
      g.beginPath(); g.rect(-W + 5, y - H + 5, 2 * W - 10, 2 * H - 10); g.clip();
      if (o.footage) { // grainy night footage: a gapped walkway and two figures in the rain
        sk(g, P, [-W, y + 40, -36, y + 34, -22, y + 40], { w: 5, c, j: 1 });
        sk(g, P, [2, y + 40, W, y + 34], { w: 5, c, j: 1 });
        sk(g, P, [-W, y + 8, W, y + 4], { w: 2, c, a: 0.5, j: 2 });
        ring(g, P, 40, y - 2, 7.5, 7.5, { w: 3, c: '#ff9a88', n: 10, j: 0.2 });
        sk(g, P, [40, y + 5, 40, y + 22, 34, y + 38], { w: 3, c: '#ff9a88', j: 0.2 });
        sk(g, P, [40, y + 22, 46, y + 38], { w: 3, c: '#ff9a88', j: 0.2 });
        // the figure
        const fx = -6;
        ring(g, P, fx, y - 26, 10, 10, { w: 3, c: '#fbfbf2', n: 12, j: 0.2 });
        sk(g, P, [fx, y - 16, fx, y + 12], { w: 3, c: '#fbfbf2', j: 0.2 });
        sk(g, P, [fx, y - 8, fx - 14, y + 4], { w: 3, c: '#fbfbf2', j: 0.2 }); sk(g, P, [fx, y - 8, fx + 22, y + 2], { w: 3, c: '#fbfbf2', j: 0.2 });
        sk(g, P, [fx, y + 12, fx - 10, y + 38], { w: 3, c: '#fbfbf2', j: 0.2 }); sk(g, P, [fx, y + 12, fx + 10, y + 38], { w: 3, c: '#fbfbf2', j: 0.2 });
        // rain and grain
        const r = rng(Math.floor(t * 12) + 3);
        for (let i = 0; i < 40; i++) { const x = (r() - 0.5) * 300, yy = y - H + r() * 2 * H; sk(g, P, [x, yy, x - 3, yy + 12], { w: 1.2, c, a: 0.45, j: 0 }); }
        for (let i = 0; i < 140; i++) dot(g, css(c, r() * 0.25), (r() - 0.5) * 300, y - H + r() * 2 * H, 0.9);
        const fl = 0.04 + 0.04 * Math.abs(Math.sin(t * 13));
        g.fillStyle = css('#ffffff', fl); g.fillRect(-W, y - H, 2 * W, 2 * H);
      }
      if (o.text) boxText(g, o.text, 0, y, 280, 2 * H - 20, 44, c, 800);
      g.restore();
    } },
    bracket: { ground: false, h: 150, draw(g, P, t, o) {
      const c = inkOf(P), won = o.won ?? 3;
      const rows = [-54, -18, 18, 54], cols = [-110, -30, 50];
      const edge = (x, y0, y1, x2, i) => sk(g, P, [x, y0, x + 40, y0, x + 40, y1, x2, y1], { w: i < won ? 4 : 2.4, c: i < won ? GOLD : c, a: i < won ? 1 : 0.5, j: 0.4 });
      edge(cols[0], rows[0], (rows[0] + rows[1]) / 2, cols[1] + 20, 0);
      edge(cols[0], rows[1], (rows[0] + rows[1]) / 2, cols[1] + 20, 0);
      edge(cols[0], rows[2], (rows[2] + rows[3]) / 2, cols[1] + 20, 1);
      edge(cols[0], rows[3], (rows[2] + rows[3]) / 2, cols[1] + 20, 9);
      edge(cols[1] + 20, (rows[0] + rows[1]) / 2, 0, cols[2] + 8, 2);
      edge(cols[1] + 20, (rows[2] + rows[3]) / 2, 0, cols[2] + 8, 2);
      if (o.text) boxText(g, o.text, 114, 0, 104, 56, 24, GOLD, 800);
    } },
    burst: { ground: false, h: 180, draw(g, P, t, o) {
      const k = clamp(o.grow ?? 1), c = o.color || GOLD;
      if (!P.outline || true) glow(g, 0, 0, 180 * k, c, 0.6 * k);
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU + t * 0.4, r1 = 34 * k, r2 = (70 + (i % 3) * 32) * k; sk(g, P, [Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(a) * r2, Math.sin(a) * r2], { w: 4, c, j: 0.8, seed: i }); }
      ring(g, P, 0, 0, 28 * k, 28 * k, { w: 4, c, fill: css(c, 0.6), j: 0.6 });
    } },
    // ---------- things in thought bubbles ----------
    rope: { ground: false, h: 70, draw(g, P, t, o) {
      const c = o.color || tint(P, '#e8d6a0', 0.8);
      for (let i = 0; i < 4; i++) ring(g, P, -4 + i * 3, 0, 40 - i * 3, 18 - i, { w: 5, c, n: 14, j: 0.5, seed: i });
      sk(g, P, [36, 6, 54, 24, 66, 16, 72, 34], { w: 5, c, smooth: true, j: 0.3 });
    } },
    ladder: { ground: false, h: 120, draw(g, P, t, o) {
      const c = o.color || tint(P, '#c89a5a', 0.75);
      sk(g, P, [-18, -70, -18, 70], { w: 5, c, j: 0.5 }); sk(g, P, [18, -70, 18, 70], { w: 5, c, j: 0.5 });
      for (let i = 0; i < 6; i++) sk(g, P, [-18, -58 + i * 22, 18, -58 + i * 22], { w: 4, c, j: 0.5, seed: i });
    } },
    boat: { k: 1.4, ground: true, draw(g, P, t, o) {
      const f = tint(P, o.color || '#c89a5a', 0.4);
      sk(g, P, [-110, -50, -80, 0, 80, 0, 110, -50, 0, -40], { close: true, w: 5, fill: f, smooth: false, j: 0.7 });
      sk(g, P, [-96, -38, 96, -38], { w: 2.2, a: 0.7, j: 0.6 });
      sk(g, P, [0, -44, 0, -190], { w: 5, j: 0.4 });
      sk(g, P, [6, -184, 6, -60, 80, -60], { close: true, w: 4.5, fill: tint(P, '#f6f4e6', 0.35), j: 0.6 });
    } },
    pony: { ground: true, draw(g, P, t, o) {
      const c = o.color || inkOf(P);
      // a horrifying little attempt: wrong proportions, wrong knees, too many teeth
      sk(g, P, [-52, -62, -30, -92, 30, -86, 46, -56, 18, -44, -38, -46], { close: true, smooth: true, w: 4.5, c, fill: true, j: 1.5 });
      sk(g, P, [28, -88, 42, -142, 66, -146], { w: 6, c, j: 1.2 });
      ring(g, P, 74, -144, 28, 14, { w: 4.5, c, n: 11, j: 1.5, fill: boardOf(P) });
      dot(g, c, 62, -152, 4); dot(g, c, 84, -152, 2.2);
      sk(g, P, [62, -135, 96, -136], { w: 2.4, c, j: 0.4 });
      for (let i = 0; i < 5; i++) sk(g, P, [66 + i * 6, -135, 66 + i * 6, -129], { w: 1.8, c, j: 0.2 });
      sk(g, P, [-36, -48, -46, -26, -28, -18, -44, 0], { w: 5, c, j: 1 });
      sk(g, P, [-10, -44, -2, -22, -16, 0], { w: 5, c, j: 1 });
      sk(g, P, [20, -44, 34, -18, 16, -10, 30, 0], { w: 5, c, j: 1 });
      sk(g, P, [34, -50, 46, -30, 42, 0], { w: 5, c, j: 1 });
      sk(g, P, [-50, -70, -72, -90, -78, -60, -68, -52], { w: 5, c, smooth: true, j: 1 });
      sk(g, P, [52, -158, 42, -172, 64, -164, 66, -180, 76, -162], { w: 3, c, j: 0.8 });
    } },
    // ---------- home and storm ----------
    coathook: { ground: false, h: 110, draw(g, P, t, o) {
      const c = inkOf(P);
      sk(g, P, [-34, -44, 34, -44], { w: 5, c }); sk(g, P, [0, -44, 0, -30, 9, -24], { w: 3.6, c, smooth: true, j: 0 });
      if (o.coat !== false) {
        const f = tint(P, o.color || '#c8b6ff', 0.4);
        sk(g, P, [-24, -10, -40, 4, -36, 40, -26, 38], { close: true, w: 3.4, c, fill: f, j: 0.5 });
        sk(g, P, [24, -10, 40, 4, 36, 40, 26, 38], { close: true, w: 3.4, c, fill: f, j: 0.5 });
        sk(g, P, [0, -28, -28, -8, -32, 56, 32, 56, 28, -8], { close: true, w: 4, c, fill: f, j: 0.8 });
        sk(g, P, [0, -22, 0, 56], { w: 2.2, c, j: 0.3 }); sk(g, P, [-10, -22, 0, -10, 10, -22], { w: 2.6, c, j: 0.2 });
      }
      else if (o.leash) sk(g, P, [8, -24, 18, 8, 6, 34, 18, 52], { w: 3, c: tint(P, CORAL, 0.7), smooth: true, j: 0.3 });
    } },
    flashlight: { ground: false, h: 60, grip: [-14, 0], draw(g, P, t, o) {
      const c = inkOf(P), len = o.beam ?? 360, on = o.on !== false;
      if (on) {
        const gr = g.createLinearGradient(30, 0, 30 + len, 0);
        gr.addColorStop(0, css(GOLD, 0.45)); gr.addColorStop(1, css(GOLD, 0));
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(30, -10); g.lineTo(30 + len, -len * 0.38); g.lineTo(30 + len, len * 0.38); g.lineTo(30, 10); g.closePath(); g.fill();
      }
      sk(g, P, [-40, -9, 16, -9, 30, -16, 30, 16, 16, 9, -40, 9], { close: true, w: 4, c, fill: true, j: 0.3 });
    } },
    // an inset: a frame drawn on the board, for split screens and pictures
    panel: { ground: false, h: 200, draw(g, P, t, o) {
      const w = o.w ?? 160, h = o.h ?? 100;
      sk(g, P, [-w, -h, w, -h, w, h, -w, h], { close: true, w: o.outline === false ? 0 : num(o.outlineWidth, 5), c: o.outlineColor, fill: o.fill || boardOf(P), j: 0.8 });
      if (o.text) boxText(g, o.text, 0, -h + 24, w * 2 - 20, 40, 26, o.textColor || inkOf(P), 800);
    } },
    // wet sand with a finger line, for the "any material" beat
    sandpatch: { ground: true, draw(g, P, t, o) {
      sk(g, P, [-120, 0, -96, -14, 96, -16, 120, 0], { close: true, smooth: true, w: 3, fill: tint(P, '#d9b97a', 0.45), j: 1 });
      const r = rng(4);
      for (let i = 0; i < 26; i++) dot(g, css(inkOf(P), 0.35), (r() - 0.5) * 220, -2 - r() * 12, 1);
    } },
    map: { ground: false, h: 160, draw(g, P, t, o) {
      const c = inkOf(P);
      sk(g, P, [-120, -78, 120, -78, 120, 78, -120, 78], { close: true, w: 4, fill: true, j: 0.8 });
      sk(g, P, [-14, -78, 8, -30, -10, 10, 14, 78], { w: 11, c: tint(P, '#9fd8ff', 0.8), smooth: true, j: 0.8 }); // creek
      dot(g, GOLD, -86, 30, 7); dot(g, GOLD, 84, 30, 7);
      if (o.long !== false) sk(g, P, [-86, 30, -74, -40, -40, -70, 24, -70, 74, -40, 84, 30], { w: 3, c: faint(P), smooth: true, j: 0.5 });
      const k = clamp(o.short ?? 1);
      if (k > 0) sk(g, P, [-86, 30, lerp(-86, 84, k), 30], { w: 4.5, c: GOLD, j: 0.5 });
      if (o.text) boxText(g, o.text, 0, 58, 180, 30, 18, c, 800);
    } },
    trophy: { ground: true, draw(g, P) {
      const f = tint(P, GOLD, 0.65);
      sk(g, P, [-30, 0, 30, 0, 30, -14, -30, -14], { close: true, w: 4.4, fill: true });
      sk(g, P, [-8, -14, 8, -14, 8, -44, -8, -44], { close: true, w: 4, fill: f });
      sk(g, P, [-36, -110, 36, -110, 34, -76, 14, -48, -14, -48, -34, -76], { close: true, smooth: true, w: 4.6, fill: f, j: 0.3 });
      sk(g, P, [-36, -104, -56, -102, -50, -74, -28, -70], { w: 4.4, c: f, smooth: true, j: 0.3 });
      sk(g, P, [36, -104, 56, -102, 50, -74, 28, -70], { w: 4.4, c: f, smooth: true, j: 0.3 });
    } },
    tv: { ground: false, h: 120, draw(g, P, t, o) {
      const c = inkOf(P);
      sk(g, P, [-108, -66, 108, -66, 108, 66, -108, 66], { close: true, w: 5, fill: P.outline ? mix(boardOf(P), '#000000', 0.2) : P.propDark, j: 0.5 });
      box(g, P, -98, -56, 196, 112, { w: 2.6, c, fill: P.outline ? mix(boardOf(P), '#d8ebe6', 0.18) : P.screen, j: 0.4 });
      sk(g, P, [-14, -66, -36, -94], { w: 3, c, j: 0.3 }); sk(g, P, [14, -66, 36, -94], { w: 3, c, j: 0.3 });
      if (o.text) boxText(g, o.text, 0, 0, 196, 112, 30, P.outline ? inkOf(P) : '#1a2230', 800);
    } },
    phone: { ground: false, h: 60, draw(g, P, t, o) {
      sk(g, P, [-18, -32, 18, -32, 18, 32, -18, 32], { close: true, w: 3.6, fill: P.outline ? mix(boardOf(P), '#000000', 0.2) : P.propDark, j: 0.2 });
      box(g, P, -14, -26, 28, 50, { w: 1.8, fill: P.outline ? mix(boardOf(P), '#d8ebe6', o.lit ? 0.5 : 0.2) : P.screen, j: 0.1 });
      if (!P.outline && o.glow !== false) glow(g, 0, 0, 70, P.screen, 0.25);
      if (o.lit && P.outline) glow(g, 0, 0, 60, '#d8ebe6', 0.3);
      if (o.text) boxText(g, o.text, 0, 0, 26, 46, 11, inkOf(P), 800);
    } },
    fridge: { ground: true, draw(g, P, t, o) {
      const c = inkOf(P), k = Math.cos(clamp(o.open ?? 0) * 1.2);
      sk(g, P, [-40, -190, 40, -190, 40, 0, -40, 0], { close: true, w: 5, fill: true, j: 0.4 });
      sk(g, P, [-40, -120, 40, -120], { w: 3.4, c, j: 0.4 });
      if (o.open) {
        box(g, P, -35, -185, 70, 60, { w: 2, c, fill: tint(P, '#fff5c0', 0.5), j: 0.2 });
        box(g, P, -35, -115, 70, 110, { w: 2, c, fill: tint(P, '#fff5c0', 0.5), j: 0.2 });
        glow(g, 0, -100, 110, '#fff5c0', 0.3 * clamp(o.open));
        for (let i = 0; i < 2; i++) sk(g, P, [-34, -82 + i * 36, 34, -82 + i * 36], { w: 2, c, a: 0.6 });
        sk(g, P, [40, -190, 40 + 60 * (1 - k), -180, 40 + 60 * (1 - k), -12, 40, 0], { close: true, w: 4, fill: true, j: 0.3 });
      } else {
        sk(g, P, [28, -170, 28, -140], { w: 4, c, j: 0 }); sk(g, P, [28, -100, 28, -60], { w: 4, c, j: 0 });
      }
    } },
  };
}

export const DRAWN_GEOMETRY = {
  dog: { box: [130, 96] },
  tripod: { box: [130, 96] },
  hand: { box: [200, 220] },
  line: { box: [10, 10] }, glow: { box: [10, 10] },
  flock: { box: [840, 360] },
  bird: { box: [150, 80] }, gull: { box: [150, 80] }, swallow: { box: [130, 70] }, heron: { box: [190, 150] },
  bike: { box: [150, 96], surface: { top: 72, x0: -28, x1: -6 } },
  sandwich: { box: [104, 66] },
  notebook: { box: [130, 80] },
  page: { box: [108, 140] },
  stickman: { box: [70, 140] },
  wrongfigure: { box: [180, 240] },
  eraser: { box: [100, 34] },
  pancakes: { box: [124, 60] },
  catpancake: { box: [142, 100] },
  cereal: { box: [110, 160] },
  plate: { box: [124, 10] },
  plates: { box: [100, 60] },
  flatchair: { box: [74, 112], surface: { top: 46, x0: -30, x1: 30 } },
  armchair: { box: [112, 112], surface: { top: 40, x0: -36, x1: 36 } },
  masthill: { box: [460, 290] },
  mast: { box: [50, 240] },
  boardwalk: { box: [800, 44] },
  railing: { box: [800, 66] },
  barrier: { box: [400, 50] },
  crowd: { box: [920, 170] },
  banner: { box: [300, 90] },
  waves: { box: [1240, 90] },
  footbridge: { box: [400, 110], surface: { top: 10, x0: -200, x1: 200, ramp: 14 } },
  creek: { box: [960, 195] },
  donotcross: { box: [130, 150] },
  prints: { box: [280, 16] },
  stencil: { box: [150, 170] },
  cavewall: { box: [540, 300] },
  contract: { box: [160, 170] },
  bill: { box: [84, 130] },
  banknote: { box: [130, 66] },
  wallet: { box: [100, 58] },
  cheque: { box: [224, 76] },
  nametag: { box: [70, 70] },
  balance: { box: [280, 160] },
  scales: { box: [124, 80] },
  perspective: { box: [480, 240] },
  depthbox: { box: [200, 160] },
  pen3d: { box: [100, 240] },
  phonestream: { box: [108, 196] },
  bigscreen: { box: [304, 224] },
  bracket: { box: [320, 130] },
  burst: { box: [240, 240] },
  rope: { box: [150, 90] },
  ladder: { box: [50, 150] },
  pony: { box: [190, 190] },
  coathook: { box: [80, 110] },
  flashlight: { box: [80, 40] },
  panel: { box: [320, 200] },
  sandpatch: { box: [240, 20] },
  map: { box: [244, 160] },
  trophy: { box: [116, 112] },
  whiteboard: { box: [240, 156] },
  fridge: { box: [84, 190] },
  umbrella: { box: [150, 200] },
};
