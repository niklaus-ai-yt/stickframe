// The stick-figure rig: skeleton, pose library, procedural motion, faces and wardrobe.
import { DEG, TAU, lerp, clamp, wobble, css, shade, mix, circle, ellipse } from './util.js';

// Bone lengths in rig units (figure is ~300 units tall at scale 1).
export const BONES = { head: 30, neck: 8, torso: 96, upper: 50, fore: 48, thigh: 58, shin: 58, foot: 15 };
const W = { limb: 11, torso: 13 };

// Angles in degrees. Arms/legs: [base, bend]. Base is measured from straight
// down, positive = toward the facing direction. Elbow bend + folds the forearm
// forward/up; knee bend + folds the shin backward.
const P = (o) => ({ lean: 0, head: 0, la: [6, 10], ra: [-6, 12], ll: [4, 3], rl: [-4, 3], rot: 0, air: 0, ...o });
export const POSES = {
  stand: P({}),
  point: P({ ra: [84, 0], la: [4, 12], head: -2 }),
  pointUp: P({ ra: [162, 4], la: [4, 12], head: -14 }),
  pointDown: P({ ra: [40, 0], head: 14 }),
  wave: P({ ra: [150, 34], la: [4, 12], anim: 'wave' }),
  cheer: P({ la: [-150, 12], ra: [152, 14], head: -12, ll: [14, 2], rl: [-12, 2], anim: 'bounce' }),
  victory: P({ ra: [168, 20], la: [-20, 30], head: -8 }),
  shrug: P({ la: [12, 78], ra: [16, 74], head: 12 }),
  think: P({ ra: [60, 135], la: [-10, 100], head: 6 }),
  facepalm: P({ ra: [100, 120], la: [4, 8], head: 26, lean: 8 }),
  crossArms: P({ la: [-20, 110], ra: [-16, 106] }),
  hips: P({ la: [-34, 104], ra: [-30, 108], lean: -3, ll: [9, 2], rl: [-9, 2] }),
  scared: P({ lean: -10, la: [62, 92], ra: [72, 100], ll: [12, 12], rl: [-16, 6], head: -4, anim: 'shiver' }),
  panic: P({ la: [140, 90], ra: [146, 86], ll: [10, 16], rl: [-12, 14], anim: 'jitter' }),
  sad: P({ lean: 12, head: 26, la: [0, 4], ra: [2, 4], ll: [2, 4], rl: [-2, 4] }),
  angry: P({ lean: 8, head: 8, la: [-12, 34], ra: [-8, 38], ll: [12, 2], rl: [-12, 2], anim: 'shiver' }),
  celebrate: P({ la: [-150, 20], ra: [150, 30], ll: [30, 50], rl: [-10, 40], anim: 'hop' }),
  jump: P({ la: [150, 20], ra: [140, 20], ll: [40, 70], rl: [10, 60], air: 60 }),
  fall: P({ rot: 82, la: [120, 20], ra: [160, 30], ll: [20, 30], rl: [-10, 10] }),
  lie: P({ rot: 90, la: [6, 0], ra: [-6, 0], ll: [2, 0], rl: [-2, 0], head: -6 }),
  sit: P({ lean: -4, la: [36, 46], ra: [42, 38], ll: [84, 84], rl: [88, 88] }),
  sitFloor: P({ lean: 6, la: [40, 30], ra: [46, 26], ll: [84, 162], rl: [80, 150] }),
  kneel: P({ lean: 4, rl: [72, 72], ll: [-8, 98], ra: [30, 30], la: [20, 20] }),
  // both knees on the ground, shins flat behind, hips over the knees (fb: folded legs seen from the front)
  kneelDown: P({ lean: 4, head: 4, ll: [7, 97], rl: [-5, 85], la: [8, 12], ra: [14, 16], fb: 1 }),
  kneelBow: P({ lean: 24, head: 30, ll: [7, 97], rl: [-5, 85], la: [20, 6], ra: [26, 8], fb: 1 }),
  recoil: P({ lean: -14, head: -8, la: [66, 100], ra: [76, 108], ll: [10, 8], rl: [-12, 4] }),
  eat: P({ ra: [64, 138], la: [18, 40], head: 6, lean: 2 }),
  crouch: P({ lean: 32, head: -20, la: [52, 24], ra: [62, 20], ll: [64, 124], rl: [52, 112] }),
  type: P({ lean: 6, head: 10, la: [52, 44], ra: [58, 38], anim: 'type' }),
  hold: P({ ra: [42, 66], la: [6, 10] }),
  carry: P({ la: [20, 70], ra: [24, 66], lean: -4 }),
  phone: P({ ra: [30, 128], head: 16, la: [6, 10] }),
  drink: P({ ra: [80, 125], head: -16, lean: -3 }),
  lookUp: P({ head: -32, lean: -6, la: [-4, 10], ra: [-8, 12] }),
  reach: P({ ra: [172, 2], la: [10, 12], lean: -6, head: -18 }),
  push: P({ lean: 28, la: [86, 18], ra: [80, 14], ll: [-24, 8], rl: [28, 24] }),
  dance: P({ anim: 'dance' }),
  bow: P({ lean: 52, head: 20, la: [-6, 4], ra: [-4, 4] }),
  talk: P({ ra: [46, 44], la: [8, 14], anim: 'talk' }),
  clap: P({ la: [62, 70], ra: [66, 66], anim: 'clap' }),
  sleep: P({ rot: 90, la: [8, 30], ra: [-4, 20], ll: [6, 10], rl: [-2, 6], head: 4, anim: 'breathe' }),
  float: P({ la: [80, 30], ra: [100, 20], ll: [20, 30], rl: [-10, 20], air: 60, anim: 'bob' }),
  swim: P({ rot: 78, la: [150, 10], ra: [20, 10], ll: [10, 10], rl: [-12, 10], anim: 'swim' }),
  tired: P({ lean: 22, head: 30, la: [-2, 2], ra: [0, 2], ll: [10, 16], rl: [-6, 12], anim: 'breathe' }),
  dizzy: P({ head: 14, la: [40, 10], ra: [30, 20], anim: 'sway' }),
  nod: P({ anim: 'nod' }),
  no: P({ anim: 'shake' }),
  laugh: P({ lean: -6, head: -16, la: [10, 90], ra: [14, 96], anim: 'laugh' }),
  cry: P({ lean: 10, head: 20, la: [96, 122], ra: [100, 118], anim: 'shiver' }),
  stop: P({ ra: [84, 84], la: [4, 12], lean: -4 }),
  present: P({ ra: [64, -8], la: [6, 12], head: -4 }),
  write: P({ ra: [60, 40], head: 18, lean: 8, anim: 'write' }),
  lift: P({ la: [168, 6], ra: [168, 6], ll: [12, 10], rl: [-12, 10], anim: 'shiver' }),
  pray: P({ la: [0, 118], ra: [4, 116], head: 18 }),
  salute: P({ ra: [110, 95], la: [2, 4] }),
  hug: P({ la: [76, 70], ra: [80, 66], lean: 6 }),
  // Held strides: a real walk or run comes from walkTo / runTo / exit (or "march": true on the spot).
  run: P({ ll: [46, 72], rl: [-26, 38], la: [-38, 84], ra: [38, 84], lean: 14, anim: 'run' }),
  walk: P({ ll: [20, 8], rl: [-14, 22], la: [-16, 16], ra: [16, 16], lean: 3, anim: 'walk' }),
  carried: P({ rot: -38, head: -10, ll: [60, 92], rl: [48, 80], la: [18, 48], ra: [-12, 58], lean: 0 }),
  ride: P({ lean: 16, head: -6, la: [50, 20], ra: [50, 20], ll: [60, 60], rl: [30, 40] }),
};
export const POSE_IDS = Object.keys(POSES);

export const MOODS = {
  neutral: { eyes: 'dot', mouth: 'line' },
  happy: { eyes: 'dot', mouth: 'smile' },
  joy: { eyes: 'arc', mouth: 'grin' },
  excited: { eyes: 'wide', mouth: 'grin', brows: 'up' },
  proud: { eyes: 'arc', mouth: 'smile', head: -8 },
  love: { eyes: 'heart', mouth: 'smile', blush: true },
  sad: { eyes: 'dot', mouth: 'frown', brows: 'sad' },
  cry: { eyes: 'closed', mouth: 'wavy', brows: 'sad', tear: true },
  angry: { eyes: 'dot', mouth: 'frown', brows: 'angry' },
  furious: { eyes: 'wide', mouth: 'teeth', brows: 'angry' },
  surprised: { eyes: 'wide', mouth: 'o', brows: 'up' },
  shocked: { eyes: 'pin', mouth: 'bigO', brows: 'up', sweat: true },
  scared: { eyes: 'pin', mouth: 'wavy', brows: 'sad', sweat: true },
  worried: { eyes: 'dot', mouth: 'wavy', brows: 'sad' },
  nervous: { eyes: 'dot', mouth: 'teeth', brows: 'sad', sweat: true },
  thinking: { eyes: 'up', mouth: 'smirk', brows: 'one' },
  confused: { eyes: 'dot', mouth: 'wavy', brows: 'one' },
  smirk: { eyes: 'lid', mouth: 'smirk' },
  sleepy: { eyes: 'closed', mouth: 'o' },
  bored: { eyes: 'lid', mouth: 'line' },
  determined: { eyes: 'dot', mouth: 'line', brows: 'angry' },
  dizzy: { eyes: 'swirl', mouth: 'wavy' },
  embarrassed: { eyes: 'dot', mouth: 'wavy', blush: true, sweat: true },
  cool: { eyes: 'shades', mouth: 'smirk' },
  dead: { eyes: 'x', mouth: 'wavy' },
  dread: { eyes: 'pin', mouth: 'shut', brows: 'high', sweat: true },
  spent: { eyes: 'closed', mouth: 'line', brows: 'sad' },
};
export const MOOD_IDS = Object.keys(MOODS);

export const WEAR = ['hoodie', 'shirt', 'scarf', 'cap', 'beanie', 'tie', 'bow', 'glasses', 'sunglasses', 'headband', 'labcoat', 'dress', 'cape', 'backpack', 'ponytail', 'bun', 'spiky', 'crown', 'tophat', 'headphones', 'helmet', 'mustache', 'beard'];

export function blendPose(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const o = { anim: t < 0.5 ? a.anim : b.anim };
  for (const k of ['lean', 'head', 'rot', 'air', 'fb']) o[k] = lerp(a[k] || 0, b[k] || 0, t);
  for (const k of ['la', 'ra', 'll', 'rl']) o[k] = [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)];
  return o;
}

export function clonePose(p) {
  return { ...p, la: [...p.la], ra: [...p.ra], ll: [...p.ll], rl: [...p.rl] };
}

// Procedural gait. phase in radians, run 0..1.
export function gaitPose(phase, run = 0) {
  const s = Math.sin(phase), c = Math.cos(phase);
  const legA = lerp(26, 48, run), armA = lerp(22, 46, run);
  const p = P({});
  p.lean = lerp(3, 14, run);
  p.ll = [s * legA, Math.max(0, -c) * lerp(36, 80, run) + 4];
  p.rl = [-s * legA, Math.max(0, c) * lerp(36, 80, run) + 4];
  p.la = [-s * armA, lerp(14, 84, run)];
  p.ra = [s * armA, lerp(14, 84, run)];
  p.bob = Math.abs(Math.cos(phase)) * lerp(4, 10, run);
  return p;
}

// Poses whose arms hang free: a walk swings them. Others (carry, point, phone...) keep their arms.
const FREE_ARMS = new Set(['stand', 'walk', 'run', 'sad', 'tired', 'nod', 'no']);
const HOLD_ARM = [42, 66];

// Lay a gait frame (gait.js) over a pose. w: fade of the upper body; ikw: weight of the planted
// legs against the pose's own legs (1 when the pose stands on its feet, so nothing slides).
export function applyGait(p, gf, w, ikw, dir, opts = {}) {
  const o = clonePose(p);
  const k = w * gf.env;
  const free = FREE_ARMS.has(opts.poseId);
  // opts.facing: the way the figure looks when it differs from its travel (a backward step)
  const faceDir = opts.facing ?? dir;
  const arm = (cur, swing, keep) => {
    if (keep) return [cur[0] + swing * 0.12 * k, cur[1]];
    const fwd = Math.max(0, swing) / 44;
    return [lerp(cur[0], swing * gf.env, w), lerp(cur[1], gf.elbow + fwd * 14, w)];
  };
  const heldArm = opts.heldArm || (faceDir >= 0 ? 'ra' : 'la');
  const hold = (cur, swing) => { const q = arm(HOLD_ARM, swing, true); return [lerp(cur[0], q[0], w), lerp(cur[1], q[1], w)]; };
  o.la = opts.held && heldArm === 'la' && free ? hold(p.la, gf.la) : arm(p.la, gf.la, !free);
  o.ra = opts.held && heldArm === 'ra' && free ? hold(p.ra, gf.ra) : arm(p.ra, gf.ra, !free);
  o.lean = (p.lean || 0) * (free ? 1 - w : 1) + gf.lean * k * (faceDir === dir ? 1 : -0.5);
  o.rot = (p.rot || 0) * (1 - w);
  if (faceDir === dir) o.ik = { hip: gf.hip, ll: gf.ll, rl: gf.rl, w: ikw, dir };
  else {
    // walking backward: the feet still plant in travel space; the toes keep pointing the way it faces
    const back = (a) => ({ ...a, ax: -a.ax, tx: -a.ax + (a.tx - a.ax) });
    o.ik = { hip: gf.hip, ll: back(gf.ll), rl: back(gf.rl), w: ikw, dir: faceDir };
  }
  return o;
}

// Rest state of a pose: hip height, ankle positions along a travel direction, whether it stands on its feet.
export function poseRest(p, f, dir = 1) {
  const J = solve({ ...p, air: 0, bob: 0, ik: null, armik: null }, f);
  const a = J.ll[2], b = J.rl[2];
  return { hip: -J.hip.y, feet: { ll: clamp(a.x * dir, -40, 40), rl: clamp(b.x * dir, -40, 40) }, grounded: !p.rot && a.y > -14 && b.y > -14 && -J.hip.y > 96 };
}

// Layer per-pose idle/gesture animation on top of a resolved pose.
export function animatePose(p, t, seed = 0) {
  const o = clonePose(p);
  const br = Math.sin(t * 2.4 + seed) * 1.6;
  o.lean += br * 0.4;
  o.la[0] += br; o.ra[0] -= br;
  switch (p.anim) {
    case 'wave': o.ra[1] = 34 + Math.sin(t * 12) * 26; break;
    case 'bounce': o.air = (o.air || 0) + Math.abs(Math.sin(t * 7)) * 14; o.la[0] += Math.sin(t * 7) * 8; o.ra[0] -= Math.sin(t * 7) * 8; break;
    case 'hop': o.air = (o.air || 0) + Math.abs(Math.sin(t * 6)) * 46; break;
    case 'jitter': o.lean += Math.sin(t * 40) * 2; o.head += Math.sin(t * 33) * 3; break;
    case 'shiver': o.lean += Math.sin(t * 46) * 1.2; o.la[0] += Math.sin(t * 50) * 2; o.ra[0] += Math.cos(t * 47) * 2; break;
    case 'dance': {
      const s = Math.sin(t * 8);
      o.la = [90 + s * 60, 40]; o.ra = [90 - s * 60, 40];
      o.ll = [10 + s * 14, 10]; o.rl = [-10 + s * 14, 10];
      o.lean = s * 6; o.air = Math.abs(Math.cos(t * 8)) * 10;
      break;
    }
    case 'talk': o.ra[0] += Math.sin(t * 5) * 14; o.ra[1] += Math.sin(t * 7) * 18; o.head += Math.sin(t * 4) * 3; break;
    case 'clap': { const k = Math.abs(Math.sin(t * 9)); o.la[1] = 50 + k * 40; o.ra[1] = 50 + k * 40; break; }
    case 'type': o.la[1] += Math.sin(t * 22) * 6; o.ra[1] += Math.cos(t * 19) * 6; break;
    case 'write': o.ra[1] += Math.sin(t * 14) * 8; break;
    case 'bob': o.air = (o.air || 0) + Math.sin(t * 2) * 12; o.la[0] += Math.sin(t * 2) * 10; o.ra[0] -= Math.sin(t * 2) * 10; break;
    case 'swim': o.la[0] = 90 + Math.sin(t * 5) * 80; o.ra[0] = 90 - Math.sin(t * 5) * 80; o.ll[0] = Math.sin(t * 9) * 16; o.rl[0] = -Math.sin(t * 9) * 16; break;
    case 'sway': o.lean += Math.sin(t * 3) * 10; o.head += Math.cos(t * 3) * 10; break;
    case 'nod': o.head += Math.max(0, Math.sin(t * 9)) * 16; break;
    case 'shake': o.headTurn = Math.sin(t * 14); break;
    case 'laugh': o.lean += Math.abs(Math.sin(t * 11)) * 6; o.head -= Math.abs(Math.sin(t * 11)) * 6; break;
    case 'breathe': o.lean += Math.sin(t * 1.6) * 2; break;
    default: break;
  }
  return o;
}

// Forward kinematics. Returns joint positions in rig units, origin = ground
// point under the hips, y down. f = 1 right, -1 left, 0 front.
export function solve(p, f) {
  const B = BONES;
  const front = f === 0;
  const fs = front ? 1 : f;
  const lean = front ? 0 : (p.lean || 0) * DEG;
  const hip = { x: 0, y: 0 };
  const neck = { x: hip.x + Math.sin(lean) * fs * B.torso, y: hip.y - Math.cos(lean) * B.torso };
  // pitch: degrees the head nods forward (a set gaze); from the front it dips or lifts instead
  const pitch = p.pitch || 0;
  const ha = lean + (front ? 0 : (p.head || 0) * DEG * 0.35 + pitch * DEG);
  const head = { x: neck.x + Math.sin(ha) * fs * (B.neck + B.head), y: neck.y - Math.cos(ha) * (B.neck + B.head) };
  if (front && pitch) head.y += pitch * (pitch > 0 ? 0.24 : 0.1);
  const sh = { x: neck.x - Math.sin(lean) * fs * 8, y: neck.y + Math.cos(lean) * 8 };
  const arm = (a, side) => {
    const sx = front ? side : fs;
    const base = { x: sh.x + (front ? side * 7 : 0), y: sh.y };
    const a1 = a[0] * DEG + (front ? 0 : lean);
    const el = { x: base.x + Math.sin(a1) * sx * B.upper, y: base.y + Math.cos(a1) * B.upper };
    const a2 = a1 + a[1] * DEG;
    const hd = { x: el.x + Math.sin(a2) * sx * B.fore, y: el.y + Math.cos(a2) * B.fore };
    if (front) {
      // A side-view "behind the back" angle has no meaning from the front: it would throw the arm across
      // the body. Keep the hand's height, keep it on its own side and off the crotch, elbow out.
      const low = hd.y > hip.y - 45 && hd.y < hip.y + 45 && Math.abs(hd.x) < 24;
      if (a[0] < 0 || low) {
        let hx = a[0] < 0 && hd.x * side < 0 ? -hd.x : hd.x;
        if (low) hx = side * Math.max(24, Math.abs(hx));
        const { mid, end } = twoBone(base, { x: hx, y: hd.y }, B.upper, B.fore, side, 0.5);
        return [base, mid, end];
      }
    }
    return [base, el, hd];
  };
  const leg = (l, side) => {
    const sx = front ? side : fs;
    const base = { x: hip.x + (front ? side * 6 : 0), y: hip.y };
    const a1 = (front ? Math.abs(l[0]) * 0.25 + 4 : l[0]) * DEG;
    const kn = { x: base.x + Math.sin(a1) * sx * B.thigh, y: base.y + Math.cos(a1) * B.thigh };
    const a2 = a1 - (front ? 0 : l[1]) * DEG;
    const ft = { x: kn.x + Math.sin(a2) * sx * B.shin, y: kn.y + Math.cos(a2) * B.shin };
    const toe = { x: ft.x + (front ? side * 6 : fs * B.foot), y: ft.y };
    if (front && (p.sb || p.fb)) {
      // legs folded toward the camera: seated (sb) the thighs foreshorten and the shins hang;
      // kneeling (fb) the thighs come straight down and the shins disappear behind them
      const sb = p.sb || 0, fb = p.fb || 0, w = Math.max(sb, fb), L = (q, x, y) => { q.x = lerp(q.x, x, w); q.y = lerp(q.y, y, w); };
      const kx = base.x + side * (sb ? 22 : 6), ky = base.y + (sb ? 8 : 56);
      L(kn, kx, ky);
      const ax = kn.x + side * 3, ay = kn.y + (sb ? B.shin : 2);
      L(ft, ax, ay);
      L(toe, ax + side * 6, ay);
    }
    return [base, kn, ft, toe];
  };
  const J = {
    hip, neck, head, sh,
    la: arm(p.la, -1), ra: arm(p.ra, 1),
    ll: leg(p.ll, -1), rl: leg(p.rl, 1),
  };
  // whole-body rotation about the hips (lying, falling, swimming)
  const rot = (p.rot || 0) * DEG * (front ? 1 : fs);
  if (rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const R = (q) => { const x = q.x, y = q.y; q.x = x * c - y * s; q.y = x * s + y * c; };
    [J.neck, J.head, J.sh].forEach(R);
    [J.la, J.ra, J.ll, J.rl].forEach((ch) => ch.forEach(R));
  }
  // ground contact: lowest point rests on y = 0
  let maxY = -1e9;
  const consider = (q, pad = 0) => { if (q.y + pad > maxY) maxY = q.y + pad; };
  J.ll.forEach((q) => consider(q, W.limb / 2));
  J.rl.forEach((q) => consider(q, W.limb / 2));
  consider(J.head, B.head);
  consider(J.neck, W.torso / 2);
  consider(hip, W.torso / 2);
  J.la.forEach((q) => consider(q, W.limb / 2));
  J.ra.forEach((q) => consider(q, W.limb / 2));
  const air = (p.air || 0) + (p.bob || 0);
  const dy = -maxY - air;
  const ik = p.ik && !front && p.ik.dir === fs ? p.ik : null;
  const dyu = ik ? lerp(dy, -ik.hip - air, ik.w) : dy;
  const shift = (d) => (q) => { q.y += d; };
  [J.hip, J.neck, J.head, J.sh].forEach(shift(dyu));
  [J.la, J.ra].forEach((ch) => ch.forEach(shift(dyu)));
  [J.ll, J.rl].forEach((ch) => ch.forEach(shift(dy)));
  if (ik) { J.ll = ikLeg(J.ll, ik.ll, ik, fs, air); J.rl = ikLeg(J.rl, ik.rl, ik, fs, air); }
  if (p.armik) for (const k of ['la', 'ra']) if (p.armik[k]) J[k] = ikArm(J[k], p.armik[k], fs);
  return J;
}

const twoBone = (a, b, s, t, bendX, bendY) => {
  const dx = b.x - a.x, dy = b.y - a.y, d0 = Math.hypot(dx, dy) || 1;
  const d = clamp(d0, Math.abs(s - t) + 1, s + t - 0.02);
  const ux = dx / d0, uy = dy / d0;
  const al = (s * s - t * t + d * d) / (2 * d), h = Math.sqrt(Math.max(0, s * s - al * al));
  let px = -uy, py = ux;
  if (px * bendX + py * bendY < 0) { px = -px; py = -py; }
  return { mid: { x: a.x + ux * al + px * h, y: a.y + uy * al + py * h }, end: { x: a.x + ux * d, y: a.y + uy * d } };
};

// Two-bone IK: hip to a planted ankle, knee always bending toward the facing direction.
// Blended with the pose's own leg (fk) by ik.w. Targets are in travel coordinates.
function ikLeg(fk, a, ik, fs, air) {
  const hip = { x: 0, y: -ik.hip - air };
  const { mid: kn, end: ank } = twoBone(hip, { x: a.ax * fs, y: a.ay - air }, BONES.thigh, BONES.shin, fs, 0);
  const toe = { x: a.tx * fs, y: a.ty - air };
  if (ik.w >= 1) return [hip, kn, ank, toe];
  const L = (q, r) => ({ x: lerp(q.x, r.x, ik.w), y: lerp(q.y, r.y, ik.w) });
  return [L(fk[0], hip), L(fk[1], kn), L(fk[2], ank), L(fk[3], toe)];
}

// Two-bone IK for an arm reaching a rig-space point {x, y, w}: the elbow hangs down and back.
function ikArm(fk, a, fs) {
  const { mid, end } = twoBone(fk[0], a, BONES.upper, BONES.fore, -fs * 0.4, 1);
  const w = a.w ?? 1;
  if (w >= 1) return [fk[0], mid, end];
  const L = (q, r) => ({ x: lerp(q.x, r.x, w), y: lerp(q.y, r.y, w) });
  return [fk[0], L(fk[1], mid), L(fk[2], end)];
}

// A turn: the upper body swings round; planted legs (IK) stay exactly where they are.
function blendJoints(A, B, k, keepLegs) {
  const L = (q, r) => ({ x: lerp(q.x, r.x, k), y: lerp(q.y, r.y, k) });
  const out = {};
  for (const key of Object.keys(B)) {
    if (keepLegs && (key === 'll' || key === 'rl')) out[key] = B[key];
    else out[key] = Array.isArray(B[key]) ? B[key].map((q, i) => L(A[key][i], q)) : L(A[key], B[key]);
  }
  return out;
}

// ---------- drawing ----------
function seg(g, a, b, w, color, wob, key) {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(a.x, a.y);
  if (wob) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const off = wobble(key, key * 7.13) * wob * 5;
    g.quadraticCurveTo(mx - (dy / len) * off, my + (dx / len) * off, b.x, b.y);
  } else g.lineTo(b.x, b.y);
  g.stroke();
}

function chain(g, pts, w, color, wob, key) {
  for (let i = 0; i < pts.length - 1; i++) seg(g, pts[i], pts[i + 1], w, color, wob, key + i * 3.1);
}

// Draw the figure silhouette in body colours. `mono` overrides every colour (used for rim/sticker passes).
function body(g, J, look, color, f, mono, wob, tk, hasHoodie) {
  const fig = look.figure;
  const ink = mono || fig.ink;
  const far = mono || (f === 0 ? fig.ink : fig.far);
  const nearArm = f >= 0 ? J.ra : J.la, farArm = f >= 0 ? J.la : J.ra;
  const nearLeg = f >= 0 ? J.rl : J.ll, farLeg = f >= 0 ? J.ll : J.rl;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  chain(g, farArm, W.limb, mono || (hasHoodie ? shade(color, -0.35) : far), wob, tk + 1);
  chain(g, farLeg.slice(0, 3), W.limb, far, wob, tk + 2);
  seg(g, farLeg[2], farLeg[3], W.limb * 0.9, far, 0, 0);
  seg(g, J.hip, J.neck, W.torso, ink, wob, tk + 3);
  chain(g, nearLeg.slice(0, 3), W.limb, ink, wob, tk + 4);
  seg(g, nearLeg[2], nearLeg[3], W.limb * 0.9, ink, 0, 0);
  return { nearArm };
}

function headShape(g, J, look, mono, wob, tk) {
  const fig = look.figure;
  const r = BONES.head;
  const h = J.head;
  if (mono) { g.fillStyle = mono; circle(g, h.x, h.y, r + 0.5); g.fill(); return; }
  if (fig.head === 'outline') {
    g.fillStyle = fig.headFill;
    circle(g, h.x, h.y, r - 1);
    g.fill();
    g.strokeStyle = fig.ink;
    g.lineWidth = 7;
    g.beginPath();
    const k = wob ? wobble(tk, 3.3) * 0.6 * wob : 0; // a hand-drawn tremble, too small to read as the head changing shape
    g.ellipse(h.x, h.y, r - 2 + k, r - 2 - k, 0, 0, TAU);
    g.stroke();
  } else {
    g.fillStyle = fig.ink;
    circle(g, h.x, h.y, r);
    g.fill();
  }
}

// Face. fg = feature colour, bg = head fill colour.
function face(g, J, look, f, moodId, t, opt) {
  const fig = look.figure;
  const fg = fig.head === 'outline' ? fig.ink : fig.face;
  const bg = fig.head === 'outline' ? fig.headFill : fig.ink;
  const M = MOODS[moodId] || MOODS.neutral;
  const r = BONES.head;
  const turn = opt.headTurn || 0;
  const fxOf = (q) => (q === 0 ? turn * 0.4 : q * (0.36 + turn * 0.1));
  const tb = opt.turn; // a turn in progress slides the features across the head
  const gx = opt.look?.x || 0, gy = opt.look?.y || 0, gabs = Math.abs(gx);
  const fx0 = tb ? lerp(fxOf(tb.from), fxOf(f), tb.k) : fxOf(f);
  const fx = gx ? lerp(fx0, gx * 0.42, gabs) : fx0; // a set gaze turns the features toward it
  const cx = J.head.x + fx * r, cy = J.head.y - r * 0.06;
  const sepOf = (q) => (q === 0 ? r * 0.34 : r * 0.26);
  const sep0 = tb ? lerp(sepOf(tb.from), sepOf(f), tb.k) : sepOf(f);
  const sep = gx ? lerp(sep0, r * 0.26, gabs) : sep0;
  const e1 = { x: cx - sep, y: cy }, e2 = { x: cx + sep, y: cy };
  const blink = M.eyes !== 'closed' && ((t + opt.seed * 0.37) % opt.blinkEvery) < 0.12;
  const look2 = gx ? gx * 2 : (f === 0 ? 0 : f);
  g.lineCap = 'round';
  g.fillStyle = fg;
  g.strokeStyle = fg;
  const eyes = blink ? 'closed' : M.eyes;
  const farScale = f === 0 ? 1 : 0.82;
  const eye = (e, s) => {
    const er = r * 0.13 * s;
    const py = gy * er * 0.55; // pupils follow a vertical gaze
    switch (eyes) {
      case 'wide':
        g.fillStyle = fg; ellipse(g, e.x, e.y, er * 1.5, er * 1.7); g.fill();
        g.fillStyle = bg; circle(g, e.x + look2 * er * 0.45, e.y + py, er * 0.7); g.fill();
        break;
      case 'pin':
        g.fillStyle = fg; ellipse(g, e.x, e.y, er * 1.5, er * 1.7); g.fill();
        g.fillStyle = bg; circle(g, e.x + look2 * er * 0.3, e.y + py, er * 0.32); g.fill();
        break;
      case 'arc':
        g.lineWidth = r * 0.09; g.beginPath(); g.arc(e.x, e.y + er * 0.6, er * 1.2, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
        break;
      case 'closed':
        g.lineWidth = r * 0.08; g.beginPath(); g.moveTo(e.x - er * 1.1, e.y + er * 0.2); g.lineTo(e.x + er * 1.1, e.y + er * 0.2); g.stroke();
        break;
      case 'lid':
        g.fillStyle = fg; ellipse(g, e.x + look2 * 1.5, e.y + er * 0.35 + py * 0.5, er * 1.05, er * 0.55); g.fill();
        break;
      case 'up':
        g.fillStyle = fg; ellipse(g, e.x + look2 * 2, e.y - er * 0.7, er * 0.9, er * 1.05); g.fill();
        break;
      case 'heart': {
        const s2 = er * 1.25;
        g.fillStyle = '#ff4f7b';
        g.beginPath();
        g.moveTo(e.x, e.y + s2 * 0.9);
        g.bezierCurveTo(e.x - s2 * 1.6, e.y - s2 * 0.2, e.x - s2 * 0.6, e.y - s2 * 1.3, e.x, e.y - s2 * 0.35);
        g.bezierCurveTo(e.x + s2 * 0.6, e.y - s2 * 1.3, e.x + s2 * 1.6, e.y - s2 * 0.2, e.x, e.y + s2 * 0.9);
        g.fill();
        break;
      }
      case 'x':
        g.lineWidth = r * 0.08; g.beginPath();
        g.moveTo(e.x - er, e.y - er); g.lineTo(e.x + er, e.y + er); g.moveTo(e.x + er, e.y - er); g.lineTo(e.x - er, e.y + er); g.stroke();
        break;
      case 'swirl':
        g.lineWidth = r * 0.05; g.beginPath();
        for (let i = 0; i <= 24; i++) { const a = i / 24 * TAU * 2 + t * 6, rr = er * 1.4 * i / 24; i ? g.lineTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr) : g.moveTo(e.x, e.y); }
        g.stroke();
        break;
      default:
        g.fillStyle = fg; ellipse(g, e.x + look2 * 1.5, e.y + py, er * 0.95, er * 1.15); g.fill();
    }
  };
  if (eyes === 'shades') {
    g.fillStyle = '#0b0b10';
    g.beginPath();
    g.moveTo(e1.x - r * 0.24, cy - r * 0.12); g.lineTo(e2.x + r * 0.24, cy - r * 0.12);
    g.lineTo(e2.x + r * 0.18, cy + r * 0.14); g.lineTo(e1.x - r * 0.18, cy + r * 0.14); g.closePath(); g.fill();
    g.strokeStyle = fg; g.lineWidth = 2; g.stroke();
  } else {
    eye(e1, f > 0 ? farScale : 1);
    eye(e2, f < 0 ? farScale : 1);
  }
  // brows
  g.strokeStyle = fg;
  g.lineWidth = r * 0.07;
  const by = cy - r * 0.32;
  const brow = (e, tiltL) => { g.beginPath(); g.moveTo(e.x - r * 0.13, by + tiltL * r * 0.08); g.lineTo(e.x + r * 0.13, by - tiltL * r * 0.08); g.stroke(); };
  if (M.brows === 'up') { brow(e1, 0); brow(e2, 0); }
  // tilt > 0 raises the brow's right end. Sad: inner ends up. Angry: inner ends down.
  if (M.brows === 'sad') { brow(e1, 1); brow(e2, -1); }
  if (M.brows === 'angry') { brow(e1, -1.2); brow(e2, 1.2); }
  if (M.brows === 'one') { brow(e2, -0.6); }
  if (M.brows === 'high') { g.save(); g.translate(0, -r * 0.05); brow(e1, 0.7); brow(e2, -0.7); g.restore(); }
  // mouth
  const mxOf = (q) => (q === 0 ? turn * r * 0.4 : q * r * 0.42);
  const mx0 = J.head.x + (tb ? lerp(mxOf(tb.from), mxOf(f), tb.k) : mxOf(f));
  const mx = gx ? lerp(mx0, J.head.x + gx * r * 0.42, gabs) : mx0, my = J.head.y + r * 0.42;
  const mw = r * 0.26;
  const talk = opt.talk ? Math.abs(Math.sin(t * 15)) * 0.8 + Math.abs(Math.sin(t * 6.3)) * 0.4 : 0;
  g.lineWidth = r * 0.075;
  g.strokeStyle = fg;
  g.fillStyle = fg;
  let mouth = M.mouth;
  if (talk > 0.25 && mouth !== 'bigO') mouth = 'talk';
  switch (mouth) {
    case 'smile': g.beginPath(); g.arc(mx, my - mw * 0.55, mw, Math.PI * 0.18, Math.PI * 0.82); g.stroke(); break;
    case 'grin':
      g.beginPath(); g.moveTo(mx - mw * 1.1, my - mw * 0.25); g.quadraticCurveTo(mx, my + mw * 1.4, mx + mw * 1.1, my - mw * 0.25); g.closePath(); g.fill();
      break;
    case 'frown': g.beginPath(); g.arc(mx, my + mw * 0.75, mw, Math.PI * 1.2, Math.PI * 1.8); g.stroke(); break;
    case 'o': ellipse(g, mx, my, mw * 0.38, mw * 0.48); g.fill(); break;
    case 'bigO': ellipse(g, mx, my + mw * 0.1, mw * 0.62, mw * 0.82); g.fill(); break;
    case 'wavy':
      g.beginPath();
      for (let i = 0; i <= 8; i++) { const x = mx - mw + (i / 8) * mw * 2, y = my + Math.sin(i * 1.6) * mw * 0.18; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      break;
    case 'smirk': g.beginPath(); g.moveTo(mx - mw * 0.8, my + mw * 0.05); g.quadraticCurveTo(mx + mw * 0.3, my + mw * 0.15, mx + mw * 0.9, my - mw * 0.35); g.stroke(); break;
    case 'teeth':
      g.fillStyle = fg; g.fillRect(mx - mw, my - mw * 0.32, mw * 2, mw * 0.64);
      g.strokeStyle = bg; g.lineWidth = 2; g.beginPath();
      g.moveTo(mx - mw, my); g.lineTo(mx + mw, my);
      for (let i = -2; i <= 2; i++) { g.moveTo(mx + i * mw * 0.4, my - mw * 0.32); g.lineTo(mx + i * mw * 0.4, my + mw * 0.32); }
      g.stroke();
      break;
    case 'talk': ellipse(g, mx, my, mw * 0.55, mw * (0.15 + talk * 0.45)); g.fill(); break;
    case 'shut': g.lineWidth = r * 0.09; g.beginPath(); g.moveTo(mx - mw * 0.5, my + mw * 0.05); g.lineTo(mx + mw * 0.5, my + mw * 0.05); g.stroke(); break;
    default: g.beginPath(); g.moveTo(mx - mw * 0.7, my); g.lineTo(mx + mw * 0.7, my); g.stroke();
  }
  if (M.blush) {
    g.fillStyle = 'rgba(255,110,140,0.55)';
    ellipse(g, e1.x - r * 0.05, cy + r * 0.3, r * 0.14, r * 0.08); g.fill();
    ellipse(g, e2.x + r * 0.05, cy + r * 0.3, r * 0.14, r * 0.08); g.fill();
  }
  if (M.sweat) {
    const sx = J.head.x - (f || 1) * r * 0.75, sy = J.head.y - r * 0.55 + ((t * 0.8) % 1) * r * 0.4;
    g.fillStyle = '#8fd6ff';
    g.beginPath(); g.moveTo(sx, sy - r * 0.22); g.quadraticCurveTo(sx + r * 0.13, sy, sx, sy + r * 0.1); g.quadraticCurveTo(sx - r * 0.13, sy, sx, sy - r * 0.22); g.fill();
  }
  if (M.tear) {
    const ty = cy + r * 0.2 + ((t * 1.3) % 1) * r * 0.9;
    g.fillStyle = '#8fd6ff';
    ellipse(g, e1.x, ty, r * 0.07, r * 0.11); g.fill();
    if (f === 0) { ellipse(g, e2.x, ty, r * 0.07, r * 0.11); g.fill(); }
  }
}

// Wardrobe. Drawn in two passes: 'back' (behind the body) and 'front'.
function wear(g, J, items, color, f, pass, t, look, wo = {}) {
  if (!items || !items.length) return;
  const r = BONES.head;
  const h = J.head, n = J.neck, hip = J.hip;
  const fs = f === 0 ? 1 : f;
  const dark = shade(color, -0.35);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const it of items) {
    if (pass === 'back') {
      if (it === 'cape') {
        const sw = Math.sin(t * 3) * 10;
        g.fillStyle = color;
        g.beginPath(); g.moveTo(n.x - fs * 4, n.y + 4); g.lineTo(n.x + fs * 6, n.y + 2);
        g.quadraticCurveTo(hip.x - fs * 40, hip.y, hip.x - fs * (70 + sw), hip.y + 70); g.lineTo(hip.x - fs * (20 + sw * 0.5), hip.y + 74); g.closePath(); g.fill();
      } else if (it === 'backpack') {
        const bx = (n.x + hip.x) / 2 - fs * 20, by = (n.y + hip.y) / 2 - 6;
        g.fillStyle = color; g.beginPath(); g.ellipse(bx, by, 18, 32, 0, 0, TAU); g.fill();
        g.fillStyle = dark; g.fillRect(bx - 12, by + 6, 24, 10);
      } else if (it === 'ponytail') {
        const sw = Math.sin(t * 4) * 6;
        g.strokeStyle = wo.hairColor || look.figure.ink; g.lineWidth = 12;
        g.beginPath(); g.moveTo(h.x - fs * r * 0.7, h.y - r * 0.4); g.quadraticCurveTo(h.x - fs * r * 1.5, h.y - r * 0.2, h.x - fs * (r * 1.4 + sw), h.y + r * 0.9); g.stroke();
        g.fillStyle = color; circle(g, h.x - fs * r * 0.85, h.y - r * 0.45, 7); g.fill();
      } else if (it === 'hoodie') {
        g.fillStyle = color; g.beginPath(); if (f === 0) g.arc(h.x, h.y + 6, r + 3, 0, Math.PI); else g.arc(h.x - fs * 9, h.y + 3, r + 2, 0, TAU); g.fill();
      } else if (it === 'labcoat') {
        g.fillStyle = '#f2f4f7';
        g.beginPath(); g.moveTo(n.x - 14, n.y + 6); g.lineTo(n.x + 14, n.y + 6); g.lineTo(hip.x + fs * 22, hip.y + 46); g.lineTo(hip.x - fs * 26, hip.y + 46); g.closePath(); g.fill();
      }
      continue;
    }
    switch (it) {
      case 'hoodie':
      case 'shirt': {
        g.strokeStyle = color; g.lineWidth = it === 'hoodie' ? 26 : 22;
        g.beginPath(); g.moveTo(n.x, n.y + 6); g.lineTo(hip.x, hip.y - 4); g.stroke();
        g.lineWidth = it === 'hoodie' ? 15 : 13;
        const arm = f >= 0 ? J.ra : J.la;
        g.beginPath(); g.moveTo(arm[0].x, arm[0].y); g.lineTo(arm[1].x, arm[1].y); if (it === 'hoodie') g.lineTo(lerp(arm[1].x, arm[2].x, 0.7), lerp(arm[1].y, arm[2].y, 0.7)); g.stroke();
        break;
      }
      case 'dress': {
        g.fillStyle = color;
        g.beginPath(); g.moveTo(n.x - 8, n.y + 6); g.lineTo(n.x + 8, n.y + 6); g.lineTo(hip.x + 30, hip.y + 40); g.lineTo(hip.x - 30, hip.y + 40); g.closePath(); g.fill();
        break;
      }
      case 'labcoat': {
        g.strokeStyle = '#f2f4f7'; g.lineWidth = 9;
        g.beginPath(); g.moveTo(n.x + fs * 7, n.y + 8); g.lineTo(hip.x + fs * 20, hip.y + 44); g.stroke();
        break;
      }
      case 'scarf': {
        const sw = Math.sin(t * 5) * 6;
        g.strokeStyle = color; g.lineWidth = 12;
        g.beginPath(); g.moveTo(n.x - fs * 10, n.y + 2); g.lineTo(n.x + fs * 10, n.y + 2); g.stroke();
        g.lineWidth = wo.scarf ? 7 : 10;
        g.beginPath(); g.moveTo(n.x - fs * 8, n.y + 4);
        if (wo.scarf === 'short') g.quadraticCurveTo(n.x - fs * 16, n.y + 10, n.x - fs * (20 + sw * 0.4), n.y + 20);
        else if (wo.scarf === 'stream') { const w1 = Math.sin(t * 9) * 7, w2 = Math.sin(t * 9 + 1.4) * 10; g.bezierCurveTo(n.x - fs * 30, n.y + w1, n.x - fs * 52, n.y + 10 - w1, n.x - fs * 78, n.y + 2 + w2); }
        else g.quadraticCurveTo(n.x - fs * 28, n.y + 16, n.x - fs * (38 + sw), n.y + 34);
        g.stroke();
        break;
      }
      case 'tie': {
        g.fillStyle = color;
        const a = n, b = { x: lerp(n.x, hip.x, 0.55), y: lerp(n.y, hip.y, 0.55) };
        g.beginPath(); g.moveTo(a.x, a.y + 4); g.lineTo(b.x + 6, b.y); g.lineTo(b.x, b.y + 10); g.lineTo(b.x - 6, b.y); g.closePath(); g.fill();
        break;
      }
      case 'cap': {
        g.fillStyle = color;
        // the band and brim sit above the brows, so eyes and brows always stay visible
        const th = Math.asin((0.56 * r) / (r + 2));
        g.beginPath(); g.arc(h.x, h.y, r + 2, Math.PI + th, TAU - th); g.closePath(); g.fill();
        const dir = wo.brim ?? (f === 0 ? 0 : fs);
        g.beginPath(); g.ellipse(h.x + dir * r * 0.9, h.y - r * 0.68, lerp(r * 0.62, r * 0.72, Math.abs(dir)), 4.5, 0, 0, TAU); g.fill();
        break;
      }
      case 'beanie': {
        g.fillStyle = color;
        g.beginPath(); g.arc(h.x, h.y - 2, r + 3, Math.PI, TAU); g.closePath(); g.fill();
        g.fillStyle = dark; g.fillRect(h.x - r - 3, h.y - 10, (r + 3) * 2, 10);
        g.fillStyle = color; circle(g, h.x, h.y - r - 6, 7); g.fill();
        break;
      }
      case 'helmet': {
        g.fillStyle = color;
        g.beginPath(); g.arc(h.x, h.y, r + 5, Math.PI * 0.95, Math.PI * 2.05); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(h.x - 8, h.y - r * 0.5, 7, 0, TAU); g.fill();
        break;
      }
      case 'headband': {
        g.strokeStyle = color; g.lineWidth = 8;
        g.beginPath(); g.arc(h.x, h.y, r + 1, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
        const sw = Math.sin(t * 6) * 5;
        g.beginPath(); g.moveTo(h.x - fs * r, h.y - r * 0.35); g.lineTo(h.x - fs * (r + 18), h.y - r * 0.1 + sw); g.stroke();
        break;
      }
      case 'bow': {
        g.fillStyle = color;
        const bx = h.x - fs * r * 0.55, by = h.y - r * 0.85;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - 14, by - 10); g.lineTo(bx - 14, by + 10); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + 14, by - 10); g.lineTo(bx + 14, by + 10); g.closePath(); g.fill();
        circle(g, bx, by, 5); g.fill();
        break;
      }
      case 'glasses': {
        g.strokeStyle = color; g.lineWidth = 3.5;
        const cx = h.x + (f === 0 ? 0 : f * r * 0.36), cy = h.y - r * 0.06, sep = f === 0 ? r * 0.34 : r * 0.26;
        circle(g, cx - sep, cy, r * 0.2); g.stroke(); circle(g, cx + sep, cy, r * 0.2); g.stroke();
        g.beginPath(); g.moveTo(cx - sep + r * 0.2, cy); g.lineTo(cx + sep - r * 0.2, cy); g.stroke();
        break;
      }
      case 'sunglasses': {
        const cx = h.x + (f === 0 ? 0 : f * r * 0.36), cy = h.y - r * 0.06, sep = f === 0 ? r * 0.34 : r * 0.26;
        g.fillStyle = '#0b0b10'; g.strokeStyle = color; g.lineWidth = 3;
        g.beginPath(); g.moveTo(cx - sep - r * 0.24, cy - r * 0.13); g.lineTo(cx + sep + r * 0.24, cy - r * 0.13); g.lineTo(cx + sep + r * 0.18, cy + r * 0.14); g.lineTo(cx - sep - r * 0.18, cy + r * 0.14); g.closePath(); g.fill(); g.stroke();
        break;
      }
      case 'bun': {
        g.fillStyle = look.figure.head === 'outline' ? look.figure.ink : look.figure.ink;
        circle(g, h.x - fs * r * 0.5, h.y - r * 0.95, 12); g.fill();
        g.fillStyle = color; g.fillRect(h.x - fs * r * 0.5 - 9, h.y - r * 0.82, 18, 4);
        break;
      }
      case 'spiky': {
        g.fillStyle = color;
        g.beginPath();
        for (let i = 0; i <= 5; i++) {
          const a = Math.PI * (1.05 + i * 0.18);
          const rr = i % 2 ? r + 4 : r + 16;
          const x = h.x + Math.cos(a) * rr, y = h.y + Math.sin(a) * rr;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.lineTo(h.x + r, h.y - 4); g.lineTo(h.x - r, h.y - 4); g.closePath(); g.fill();
        break;
      }
      case 'crown': {
        g.fillStyle = color;
        const y = h.y - r + 2;
        g.beginPath(); g.moveTo(h.x - 20, y); g.lineTo(h.x - 22, y - 22); g.lineTo(h.x - 10, y - 10); g.lineTo(h.x, y - 26); g.lineTo(h.x + 10, y - 10); g.lineTo(h.x + 22, y - 22); g.lineTo(h.x + 20, y); g.closePath(); g.fill();
        break;
      }
      case 'tophat': {
        g.fillStyle = color;
        g.fillRect(h.x - 30, h.y - r - 2, 60, 7);
        g.fillRect(h.x - 19, h.y - r - 40, 38, 40);
        g.fillStyle = dark; g.fillRect(h.x - 19, h.y - r - 10, 38, 7);
        break;
      }
      case 'headphones': {
        g.strokeStyle = color; g.lineWidth = 6;
        g.beginPath(); g.arc(h.x, h.y, r + 6, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
        g.fillStyle = color;
        const ex = f === 0 ? r + 4 : 0;
        if (f === 0) { ellipse(g, h.x - ex, h.y, 8, 13); g.fill(); ellipse(g, h.x + ex, h.y, 8, 13); g.fill(); }
        else { ellipse(g, h.x - fs * 4, h.y, 10, 14); g.fill(); }
        break;
      }
      case 'mustache': {
        g.fillStyle = color;
        const mx = h.x + (f === 0 ? 0 : f * r * 0.42), my = h.y + r * 0.26;
        g.beginPath(); g.ellipse(mx - 6, my, 8, 4, 0.3, 0, TAU); g.fill(); g.beginPath(); g.ellipse(mx + 6, my, 8, 4, -0.3, 0, TAU); g.fill();
        break;
      }
      case 'beard': {
        g.fillStyle = color;
        g.beginPath(); g.arc(h.x + (f === 0 ? 0 : f * 6), h.y + 4, r * 0.95, Math.PI * 0.05, Math.PI * 0.95); g.closePath(); g.fill();
        break;
      }
      default: break;
    }
  }
}

// A figure of nothing but lines: circle head, one line body, two arms, two legs. No fills, no
// face, no clothes; every limb is one stroke, in reading order for a stroke-on reveal.
function lineFigure(g, J, a, look) {
  const c = a.lineColor || a.color || look.figure.ink;
  const lw = a.lineWeight || 5, r = BONES.head;
  const parts = (w, col) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
    g.mark?.('head'); circle(g, J.head.x, J.head.y, r - 2); g.stroke();
    const path = (pts, tag) => { g.mark?.(tag); g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.stroke(); };
    path([{ x: J.head.x + (J.neck.x - J.head.x) * (r - 2) / Math.max(1, Math.hypot(J.neck.x - J.head.x, J.neck.y - J.head.y)), y: J.head.y + (J.neck.y - J.head.y) * (r - 2) / Math.max(1, Math.hypot(J.neck.x - J.head.x, J.neck.y - J.head.y)) }, J.neck, J.hip], 'body');
    path(J.la, 'arm'); path(J.ra, 'arm');
    path(J.ll, 'leg'); path(J.rl, 'leg');
  };
  if (a.glow && !g.recording) {
    const k = a.glow === true ? 1 : a.glow;
    g.save();
    g.shadowColor = css(c, 0.9); g.shadowBlur = 22 * k * a.scale;
    parts(lw * 3.4, css(c, 0.16 * k));
    parts(lw * 1.9, css(c, 0.26 * k));
    g.restore();
  }
  parts(lw, c);
}

// Main entry. a = { x, y (ground), scale, f, pose, mood, color, wear, talk, t, seed, light: {dx,dy}, held,
//   turn: {from, k}, noFace, lineWeight, glow, lineColor }
export const figureJoints = (a) => (a.turn ? blendJoints(solve(a.pose, a.turn.from), solve(a.pose, a.f), a.turn.k, !!a.pose.ik) : solve(a.pose, a.f));

// A simple solid hand at the end of an arm: 'fist' or 'palm' (a mitten with four fingers and a thumb),
// laid along the forearm, or pointing up when there is no forearm to follow.
function handMark(g, pts, kind, color, side) {
  const q = pts[2], e = pts[1];
  const d = Math.hypot(q.x - e.x, q.y - e.y);
  const ang = d > 2 ? Math.atan2(q.y - e.y, q.x - e.x) : -Math.PI / 2;
  g.save(); g.translate(q.x, q.y); g.rotate(ang);
  g.fillStyle = color; g.strokeStyle = color; g.lineCap = 'round';
  if (kind === 'palm') {
    g.beginPath(); g.ellipse(4, 0, 10, 9.5, 0, 0, TAU); g.fill();
    g.lineWidth = 3.6;
    for (let i = 0; i < 4; i++) { const y = -6.6 + i * 4.4; g.beginPath(); g.moveTo(10, y); g.lineTo(21 - Math.abs(i - 1.4) * 1.6, y * 1.25); g.stroke(); }
    g.lineWidth = 4.2; g.beginPath(); g.moveTo(3, side * 8); g.lineTo(11, side * 15); g.stroke();
  } else {
    g.beginPath(); g.ellipse(2, 0, 9.5, 9, 0, 0, TAU); g.fill();
    g.lineWidth = 3.6; g.beginPath(); g.moveTo(-1, side * 8); g.lineTo(7, side * 8); g.stroke();
  }
  g.restore();
}
const HAT_WEAR = new Set(['cap', 'beanie', 'helmet', 'headband', 'bow', 'bun', 'spiky', 'crown', 'tophat', 'headphones']);
const FACE_WEAR = new Set(['glasses', 'sunglasses', 'mustache', 'beard']);

export function drawFigure(g, a, look, extra = {}) {
  const J0 = figureJoints(a);
  // arm modes: 'none' hides the arm, 'upper' stops it at the elbow (the hand can still be drawn)
  const trim = (ch, mode) => (mode === 'none' ? [ch[0], ch[0], ch[0]] : mode === 'upper' ? [ch[0], ch[1], ch[1]] : ch);
  const J = a.armMode ? { ...J0, la: trim(J0.la, a.armMode.la), ra: trim(J0.ra, a.armMode.ra) } : J0;
  const heldPts = a.holdArm ? J0[a.holdArm] : null;
  const fig = look.figure;
  if (a.lineWeight) {
    const S0 = a.scale;
    g.save(); g.translate(a.x, a.y); g.scale(S0, S0);
    lineFigure(g, J, a, look);
    const nearL = a.f >= 0 ? J.ra : J.la;
    if (a.held && extra.drawHeld) { const hq = (heldPts || nearL)[2]; extra.drawHeld(g, a.held, hq.x, hq.y, a.f); }
    g.restore();
    return {
      head: { x: a.x + J.head.x * S0, y: a.y + J.head.y * S0, r: BONES.head * S0 },
      hand: { x: a.x + nearL[2].x * S0, y: a.y + nearL[2].y * S0 },
      top: a.y + (J.head.y - BONES.head) * S0,
    };
  }
  const wob = (fig.wobble || 0) && a.wobble !== false ? fig.wobble : 0;
  const tk = Math.floor(a.t * 8) + (a.seed || 0) * 13;
  const items = a.wear || [];
  const hoodie = items.includes('hoodie') || items.includes('shirt');
  g.save();
  g.translate(a.x, a.y);
  g.scale(a.scale, a.scale);
  const passes = [];
  if (fig.sticker) passes.push({ mono: fig.sticker, grow: 9, dx: 0, dy: 0 });
  if (fig.rim && a.rim !== false) passes.push({ mono: fig.rim, grow: 1.5, dx: (a.light?.dx ?? -0.6) * 4.5, dy: (a.light?.dy ?? -0.8) * 4.5, glow: fig.glow });
  for (const ps of passes) {
    g.save();
    g.translate(ps.dx, ps.dy);
    if (ps.glow && extra.glow !== false) { g.shadowColor = css(ps.glow, 0.7); g.shadowBlur = 14 * a.scale; }
    g.lineWidth = 1;
    const sk = (pts) => { g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.stroke(); };
    g.strokeStyle = ps.mono; g.fillStyle = ps.mono; g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = W.limb + ps.grow * 2;
    sk(J.la); sk(J.ra); sk(J.ll); sk(J.rl);
    g.lineWidth = W.torso + ps.grow * 2 + (hoodie ? 12 : 0);
    sk([J.hip, J.neck]);
    circle(g, J.head.x, J.head.y, BONES.head + ps.grow); g.fill();
    g.restore();
  }
  const wo = { hairColor: a.hairColor, scarf: a.scarf };
  wear(g, J, items, a.color, a.f, 'back', a.t, look, wo);
  const { nearArm } = body(g, J, look, a.color || fig.ink, a.f, null, wob, tk, hoodie);
  headShape(g, J, look, null, wob, tk);
  g.mark?.('face');
  // a set gaze or a rider's turned head: the face and everything worn on the head move together
  const hf = a.headF ?? a.f, gl = a.look, tiltF = hf === 0 ? 0 : hf;
  const gx = gl?.x || 0, gy = gl?.y || 0;
  const tilted = gx || gy || a.headF != null;
  const headXf = (dy) => { const h = J.head; g.translate(h.x, h.y); if (gy && tiltF) g.rotate(gy * 0.42 * tiltF); g.translate(-h.x, -h.y + dy); };
  const faceDy = gy * BONES.head * (tiltF ? 0.1 : 0.24);
  if (!a.noFace) {
    if (tilted) { g.save(); headXf(faceDy); }
    face(g, J, look, hf, a.mood, a.t, { seed: a.seed || 0, blinkEvery: 2.6 + ((a.seed || 0) % 7) * 0.23, talk: a.talk, headTurn: a.pose.headTurn, look: gl, turn: a.headF != null ? a.headTb : a.turn });
    if (tilted) g.restore();
  }
  if (!tilted) wear(g, J, items, a.color, a.f, 'front', a.t, look, wo);
  else {
    wear(g, J, items.filter((it) => !HAT_WEAR.has(it) && !FACE_WEAR.has(it)), a.color, a.f, 'front', a.t, look, wo);
    const brim = gx ? lerp(tiltF, Math.sign(gx), Math.abs(gx)) : undefined;
    g.save(); headXf(0); wear(g, J, items.filter((it) => HAT_WEAR.has(it)), a.color, hf, 'front', a.t, look, { ...wo, brim }); g.restore();
    const r = BONES.head, fx0 = hf === 0 ? 0 : hf * 0.36, fx1 = gx ? lerp(fx0, gx * 0.42, Math.abs(gx)) : fx0;
    g.save(); headXf(faceDy); g.translate((fx1 - fx0) * r, 0); wear(g, J, items.filter((it) => FACE_WEAR.has(it)), a.color, hf, 'front', a.t, look, wo); g.restore();
  }
  // near arm on top of the torso
  g.lineCap = 'round';
  chain(g, nearArm, W.limb, fig.ink, wob, tk + 9);
  if (hoodie) {
    g.strokeStyle = a.color; g.lineWidth = items.includes('hoodie') ? 15 : 13;
    g.beginPath(); g.moveTo(nearArm[0].x, nearArm[0].y); g.lineTo(nearArm[1].x, nearArm[1].y);
    if (items.includes('hoodie')) g.lineTo(lerp(nearArm[1].x, nearArm[2].x, 0.7), lerp(nearArm[1].y, nearArm[2].y, 0.7));
    g.stroke();
  }
  if (a.hands) for (const k of ['la', 'ra']) if (a.hands[k]) handMark(g, J0[k], a.hands[k], fig.ink, (k === 'ra' ? 1 : -1) * (a.f === 0 ? 1 : a.f));
  if (a.held && extra.drawHeld) {
    const hd = (heldPts || nearArm)[2];
    extra.drawHeld(g, a.held, hd.x, hd.y, a.f);
  }
  g.restore();
  // return world-space anchors for callouts / bubbles
  const S = a.scale;
  return {
    head: { x: a.x + J.head.x * S, y: a.y + J.head.y * S, r: BONES.head * S },
    hand: { x: a.x + nearArm[2].x * S, y: a.y + nearArm[2].y * S },
    top: a.y + (J.head.y - BONES.head) * S,
  };
}

export function figureHeight(scale) {
  return (BONES.torso + BONES.thigh + BONES.shin + BONES.neck + BONES.head * 2) * scale;
}
