// Distance-locked gaits. A move becomes a footstep plan: where each foot lands and at which
// distance travelled it lifts and lands. Feet, hips and arms are functions of that distance
// (not of time), so a planted foot cannot slide in world space, whatever the speed profile.
// Everything is in rig units, measured along the direction of travel.
import { clamp, lerp, smooth } from './util.js';

const FOOT = 15, SOLE = 5.5, REACH = 115.4;
export const GAITS = {
  walk: { step: 104, front: 0.5, back: 0.7, lift: 17, hip: 110, bob: 3.5, bobAt: 0.55, lean: 4, arm: 24, elbow: 18, toeUp: 22, toeOff: 52, flat: 0.14, rise: 0.42, speed: 230, cadence: 2.1, ramp: [0.28, 0.42] },
  run: { step: 190, front: 0.3, back: 0.42, lift: 54, hip: 106, bob: 7, bobAt: 0.82, lean: 15, arm: 44, elbow: 86, toeUp: 12, toeOff: 58, flat: 0.06, rise: 0.22, speed: 620, cadence: 3.3, ramp: [0.25, 0.36] },
};

// Velocity profile of a move as an easing function k -> distance fraction: smooth ramp up,
// constant speed, smooth ramp down (none for a move that leaves the frame).
export function rampEase(T, kind, open = false) {
  const G = GAITS[kind] || GAITS.walk;
  const ti = Math.min(G.ramp[0], T * 0.35), to = open ? 0 : Math.min(G.ramp[1], T * 0.4);
  const vm = 1 / (T - ti / 2 - to / 2);
  const I = (s) => s * s * s - (s * s * s * s) / 2; // integral of smoothstep
  return (k) => {
    const t = clamp(k) * T;
    if (ti && t < ti) return vm * ti * I(t / ti);
    if (to && t > T - to) return 1 - vm * to * I((T - t) / to);
    return vm * (t - ti / 2);
  };
}

// S: distance in rig units. o0/o1: {ll, rl} rest positions of the ankles relative to the body
// at the start and end. open: keep striding past the end (the walker leaves the frame).
export function gaitPlan(S, kind, o0, o1, open = false, avoid = null) {
  const G = GAITS[kind];
  const first = o0.ll <= o0.rl ? 'll' : 'rl', other = first === 'll' ? 'rl' : 'll';
  const footOf = (k) => (k % 2 ? first : other);
  const q0 = o0[other];
  let m = Math.max(1, Math.round((S - q0) / G.step));
  let L = (S + o1[footOf(m)] - q0) / m;
  if (open) { L = G.step; m = Math.ceil((S - q0) / L) + 3; }
  const Lt = Math.max(L, 24);
  const prev = { ll: o0.ll, rl: o0.rl };
  const feet = { ll: [], rl: [] }, lands = [];
  const add = (k, to, lift, land) => {
    const foot = footOf(k);
    const st = { from: prev[foot], to, lift, land, n: k, over: !!avoid && prev[foot] < avoid[0] && to > avoid[1] };
    feet[foot].push(st);
    prev[foot] = to;
    lands.push(land);
  };
  const end = open ? Infinity : S * 0.995;
  // a gap in the ground: no foot lands in it, the step that crosses it goes high and over
  const clear = (q) => {
    if (!avoid) return q;
    const a = avoid[0] - FOOT - 2, b = avoid[1] + 2;
    return q <= a || q >= b ? q : q - a < b - q ? a : b;
  };
  for (let k = 1; k <= m; k++) {
    const q = clear(q0 + k * L);
    const lift = k === 1 ? 0 : Math.max(0, prev[footOf(k)] + G.back * Lt);
    add(k, q, lift, Math.min(end, Math.max(q - G.front * Lt, lift + Math.min(0.15 * Lt, S * 0.3))));
  }
  if (!open) {
    const foot = footOf(m + 1);
    const lift = Math.min(prev[foot] + G.back * Lt, S - Math.min(0.3 * Lt, S * 0.45));
    add(m + 1, S + o1[foot], Math.max(lift, m === 1 ? S * 0.2 : 0), end);
  }
  return { S, kind, G, L: Lt, first, other, open, feet, rest: o0, lands };
}

// One foot at distance d. Returns the ankle and toe along the travel axis with their height
// above the ground, plus what the foot is doing (phase: stance or swing; pivot: heel, flat, toe).
function stanceAt(P, q, land, lift, d) {
  const { G, L } = P;
  const flatEnd = land == null ? -Infinity : land + G.flat * L;
  const riseAt = lift == null ? Infinity : Math.max(lift - G.rise * L, flatEnd);
  if (d < flatEnd) { // heel strike: rolls onto the sole about the ankle
    const a = (G.toeUp * Math.PI / 180) * (1 - smooth((d - land) / (flatEnd - land)));
    return { x: q, up: 0, tx: q + FOOT * Math.cos(a), tup: FOOT * Math.sin(a), pivot: 'heel' };
  }
  if (d < riseAt) return { x: q, up: 0, tx: q + FOOT, tup: 0, pivot: 'flat' };
  const a = (G.toeOff * Math.PI / 180) * smooth((d - riseAt) / Math.max(1e-6, lift - riseAt)); // heel rises about the toe
  return { x: q + FOOT - FOOT * Math.cos(a), up: FOOT * Math.sin(a), tx: q + FOOT, tup: 0, pivot: 'toe' };
}

function footAt(P, foot, d, ground) {
  const list = P.feet[foot], G = P.G;
  let i = -1;
  while (i + 1 < list.length && d >= list[i + 1].lift) i++;
  const cur = i >= 0 ? list[i] : null, next = list[i + 1];
  const finish = (s, phase, w) => ({ ...s, phase, w, plant: cur && phase === 'stance' ? cur.to : phase === 'stance' ? P.rest[foot] : null });
  if (!cur) {
    const s = stanceAt(P, P.rest[foot], null, next?.lift, d), g = ground(P.rest[foot]);
    return finish({ ...s, up: s.up + g, tup: s.tup + g }, 'stance', 0);
  }
  if (d >= cur.land) {
    const s = stanceAt(P, cur.to, cur.land, next?.lift, d), g = ground(cur.to);
    return finish({ ...s, up: s.up + g, tup: s.tup + g }, 'stance', 1);
  }
  // swing: from the toe-off position to the landing, arcing over the ground
  const before = i > 0 ? list[i - 1] : null;
  const A = stanceAt(P, cur.from, before?.land ?? null, cur.lift, cur.lift - 1e-6);
  const g0 = ground(cur.from), g1 = ground(cur.to);
  const w = clamp((d - cur.lift) / Math.max(1e-6, cur.land - cur.lift));
  const reach = cur.over ? 1.5 : clamp(Math.abs(cur.to - A.x) / (0.5 * P.L));
  const x = lerp(A.x, cur.to, smooth(w));
  const up = lerp(A.up + g0, g1, w) + G.lift * reach * Math.pow(Math.sin(Math.PI * w), 1.25) * (P.kind === 'run' ? 1 - 0.35 * w : 1);
  const a0 = -Math.atan2(A.up - (A.tup ?? 0), A.tx - A.x), a1 = (G.toeUp * Math.PI / 180) * reach;
  const a = lerp(a0, a1, smooth(w));
  return finish({ x, up, tx: x + FOOT * Math.cos(a), tup: up + FOOT * Math.sin(a), pivot: 'air' }, 'swing', w);
}

// The whole lower body and arm swing at distance d. ground(q): ground height (rig units, up)
// under travel position q, relative to the ground under the body. restHip: hip height at rest.
export function gaitAt(P, d, restHip, ground = () => 0) {
  const { G, S, L, lands } = P;
  const env = smooth(d / (0.7 * L)) * (P.open ? 1 : smooth((S - d) / (0.7 * L)));
  let c = lands.length;
  if (d < lands[0]) c = d / Math.max(1e-6, lands[0]);
  else for (let k = 0; k < lands.length - 1; k++) if (d < lands[k + 1]) { c = k + 1 + (d - lands[k]) / Math.max(1e-6, lands[k + 1] - lands[k]); break; }
  const u = c - Math.floor(c);
  let hip = lerp(restHip, G.hip + G.bob * Math.cos(2 * Math.PI * (u - G.bobAt)), env);
  const feet = { ll: footAt(P, 'll', d, ground), rl: footAt(P, 'rl', d, ground) };
  for (const k of ['ll', 'rl']) {
    const a = feet[k], dx = Math.abs(a.x - d);
    const max = SOLE + a.up + Math.sqrt(Math.max(0, REACH * REACH - dx * dx));
    const wt = a.phase === 'stance' ? 1 : smooth((a.w - 0.6) / 0.4);
    hip = Math.min(hip, lerp(hip, max, wt));
  }
  const local = (a) => ({ ax: a.x - d, ay: -(SOLE + a.up), tx: a.tx - d, ty: -(SOLE + a.tup), phase: a.phase, pivot: a.pivot, plant: a.plant });
  const swing = G.arm * Math.cos(Math.PI * c);
  const arms = P.first === 'll' ? { la: swing, ra: -swing } : { la: -swing, ra: swing };
  return { hip, env, lean: G.lean, ll: local(feet.ll), rl: local(feet.rl), la: arms.la, ra: arms.ra, elbow: G.elbow };
}

// A steady gait in place, for an explicit "march" (treadmill) at time t.
const marchPlans = {};
export function gaitMarch(kind, t, restHip) {
  const G = GAITS[kind];
  const P = (marchPlans[kind] ||= gaitPlan(G.step * 40, kind, { ll: 6, rl: -10 }, { ll: 6, rl: -10 }, true));
  const d = G.step * (20 + ((t * G.cadence) % 2));
  return gaitAt(P, d, restHip);
}

// ---------- four-legged gaits (and a three-legged hop) ----------
// Same idea for a quadruped drawn in prop units: every leg has its own plants; first and last
// steps are shortened so it starts and ends standing square. legs: {key: {home, phase}}.
export function pawPlan(S, cycle, duty, legs) {
  const m = Math.max(1, Math.round(S / cycle)), C = S / m;
  const out = {};
  for (const [key, leg] of Object.entries(legs)) {
    const steps = [];
    let from = leg.home, lift = 0;
    for (let j = 0; ; j++) {
      const land = (j + leg.phase) * C;
      if (land + 0.05 * C >= S) break;
      const to = leg.home + land + (duty * C) / 2;
      if (to >= leg.home + S) break;
      const liftAt = j ? lift : Math.max(0, land - (1 - duty) * C);
      steps.push({ from, to, lift: liftAt, land: Math.max(land, liftAt + 0.08 * C) });
      from = to;
      lift = land + duty * C;
    }
    const lastLift = Math.min(steps.length ? lift : 0, S * 0.9);
    steps.push({ from, to: leg.home + S, lift: lastLift, land: Math.max(S * 0.995, lastLift + 1e-3) });
    out[key] = steps;
  }
  return { S, C, duty, steps: out, legs };
}

// Paw of one leg at distance d, relative to the body: {x, up, phase}.
export function pawAt(P, key, d, liftH) {
  const list = P.steps[key];
  let i = -1;
  while (i + 1 < list.length && d >= list[i + 1].lift) i++;
  const cur = i >= 0 ? list[i] : null;
  if (!cur) return { x: P.legs[key].home - d, up: 0, phase: 'stance', plant: P.legs[key].home };
  if (d >= cur.land) return { x: cur.to - d, up: 0, phase: 'stance', plant: cur.to };
  const w = clamp((d - cur.lift) / Math.max(1e-6, cur.land - cur.lift));
  const reach = clamp(Math.abs(cur.to - cur.from) / (0.4 * P.C));
  return { x: lerp(cur.from, cur.to, smooth(w)) - d, up: liftH * reach * Math.sin(Math.PI * w), phase: 'swing' };
}
