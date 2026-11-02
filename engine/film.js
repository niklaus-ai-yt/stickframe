// Compiles a storyboard into timed tracks and renders any frame of the film.
// renderFrame() is pure: the same (film, t) always produces the same pixels.
import { clamp, lerp, ease, css, mix, shade, rng, hash, wobble, roundRect, circle, findWordTime, smooth } from './util.js';
import { getLook, palette } from './looks.js';
import { POSES, blendPose, animatePose, drawFigure, figureHeight, BONES, solve, applyGait, poseRest, figureJoints } from './rig.js';
import { GAITS, gaitPlan, gaitAt, gaitMarch, rampEase } from './gait.js';
import { drawReveal, drawTip, traceStrokes, recordStrokes, revealProgress } from './strokes.js';
import { PROPS, drawProp, isGroundProp, layoutText, propBox, propSurface, deckDip, rideRig } from './props.js';
import { SETS, setHide } from './sets.js';
import { drawParticles, drawScreenFx, drawFreezeTint, drawGrade, EASED_SCREEN_FX, SCREEN_FX_EASE } from './fx.js';
import { drawOverlay, drawCaptions, buildCaptionChunks, BODY } from './overlays.js';

const PARTICLE_FX = new Set(['dust', 'rain', 'snow', 'sparkles', 'confetti', 'hearts', 'bubbles', 'embers', 'money', 'leaves', 'fireflies', 'stars']);
const SCREEN_FX = new Set(['speedlines', 'zoomlines', 'spotlight', 'heartbeat', 'glitch', 'lightning', 'fog', 'godrays', 'dream', 'night']);
const SIGNATURE = ['#ff5a3c', '#ffc23a', '#3fb0ff', '#4fd66a', '#c06cff', '#ff7ab6', '#22d3c5', '#ff9a3c'];
const EASES = new Set(['linear', 'in', 'out', 'inOut']);
// Surfaces that belong to a set rather than a prop: height above the floor in stage px.
const SET_SURFACES = { stage: { set: 'stage', top: 40 } };
const DIP_PREROLL = 0.3;
const TURN = 0.32; // seconds to turn round
const LIFT = 0.45; // seconds to lift something into the arms
const CRADLE = { x: 56, y: -26 }; // where arms hold a carried body: rig units from the carrier's hips
const rampOf = (m) => (m._ramp ||= rampEase(m.t1 - m.t0, m.gait === 'run' ? 'run' : 'walk', m.open));
// How many items of each kind a shot (or an actor's "do" list) keeps. The validator warns when one is hit.
export const CAPS = { do: 64, props: 160, text: 16, fx: 12, actors: 12 };
const LOOK_DIRS = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, ahead: { x: 0, y: 0 } };
const LOOK_EASE = 0.3; // default seconds for a change of gaze
const BACK_SPEED = 0.62; // a backward step is slower than a walk
// Poses that hold something up in one hand: that hand must be the one holding the prop.
const HOLD_POSES = new Set(['hold', 'phone', 'drink', 'write']);
// Poses with their own legs: a seated figure keeps those instead of taking the seated legs.
const OWN_LEGS = new Set(['sit', 'sitFloor', 'crouch', 'ride', 'kneel', 'kneelDown', 'kneelBow', 'lie', 'sleep', 'fall', 'swim', 'carried']);
const armKey = (f, hand) => (hand === 'left' ? 'la' : hand === 'right' ? 'ra' : (hand === 'far') === (f >= 0) ? 'la' : 'ra');
const lerpPt = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });

export function stageFor(aspect = '16:9') {
  const vertical = aspect === '9:16';
  const W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080;
  const figScale = vertical ? 1.25 : 1;
  return { vertical, W, H, GY: H * (vertical ? 0.66 : 0.82), figScale, propScale: figScale * 1.5 };
}

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

function resolveAt(d, shot, words) {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  if (d.word) {
    const wt = findWordTime(words, d.word, shot.start, shot.end);
    if (wt != null) return clamp(wt - shot.start + num(d.offset, 0), 0, shot.end - shot.start);
  }
  if (typeof d.t === 'number') return clamp(d.t - shot.start, 0, shot.end - shot.start);
  return clamp(num(d.at, 0), 0, Math.max(0, shot.end - shot.start));
}

function resolveUntil(d, shot, words, at) {
  const dur = shot.end - shot.start;
  if (d.untilWord) { const wt = findWordTime(words, d.untilWord, shot.start, shot.end); if (wt != null) return clamp(wt - shot.start, at, dur); }
  if (typeof d.until === 'number') return clamp(d.until, at, dur + 1);
  // on a prop that moves or traces, "dur" is the length of that motion, not of its stay on screen
  if (typeof d.dur === 'number' && d.type !== 'counter' && d.type !== 'line' && d.type !== 'meter' && !d.to && !d.stroke) return clamp(at + d.dur, at, dur + 1);
  return null;
}

// "with" (follow another actor or a prop every frame): {id | prop, dx, dy, walk, turn}
function normWith(w) {
  if (!w) return null;
  if (typeof w === 'string') return { id: w, prop: null, dx: 0, dy: 0, walk: false, turn: true };
  if (typeof w !== 'object' || (!w.id && !w.prop)) return null;
  return { id: w.id ? String(w.id) : null, prop: w.prop ? String(w.prop) : null, dx: num(w.dx, 0), dy: num(w.dy, 0), walk: !!w.walk, turn: w.turn !== false, carry: !!w.carry };
}

// Stroke-on reveal: a number (seconds) or {at|word, dur, tip, hand, tremble, real, realAt|realWord,
// color, width, stop, dieAt|dieWord, dieDur, order, glow, steps: [{at|word, dur, count}]}.
function normReveal(r, shot, words, at0) {
  if (r == null || r === false) return null;
  const o = typeof r === 'number' ? { dur: r } : typeof r === 'object' ? r : { dur: 1.5 };
  const dur = num(o.dur, 1.5);
  const at = o.at != null || o.word ? resolveAt(o, shot, words) : Math.max(0, at0 ?? 0);
  const steps = Array.isArray(o.steps) && o.steps.length ? o.steps.map((q) => ({ t: q.at != null || q.word ? resolveAt(q, shot, words) : at, dur: num(q.dur, 0.5), count: num(q.count, 1) })) : null;
  const when = (word, a) => (word ? findWordTime(words, word, shot.start, shot.end) : null) ?? null;
  const rw = when(o.realWord), dw = when(o.dieWord);
  return {
    at: steps ? steps[0].t : at, dur, steps,
    tip: o.tip ?? 'chalk', tipSize: num(o.tipSize, 1), hand: !!o.hand, tremble: num(o.tremble, 0),
    real: o.real === true ? 0.6 : num(o.real, 0),
    realAt: rw != null ? rw - shot.start : o.realAt != null ? num(o.realAt, at + dur) : null,
    color: o.color || null, width: num(o.width, 4), stop: o.stop != null ? num(o.stop, 1) : null,
    dieAt: dw != null ? dw - shot.start : o.dieAt != null ? num(o.dieAt, null) : null, dieDur: num(o.dieDur, 1),
    order: o.order || 'draw', glow: !!o.glow,
    from: o.from != null ? clamp(num(o.from, 0)) : 0, ease: EASES.has(o.ease) ? o.ease : null,
    handExit: o.handExit ? { dx: num(o.handExit.dx, 0.22), dy: num(o.handExit.dy, 0.5), dur: num(o.handExit.dur, 0.45) } : null,
  };
}

const parseLook = (v) => {
  if (typeof v === 'string') return LOOK_DIRS[v] || null;
  return v && typeof v === 'object' ? { x: clamp(num(v.x, 0), -1, 1), y: clamp(num(v.y, 0), -1, 1) } : null;
};

// One "grip" value into per-hand entries. {x, y} both hands; {x, y, hand: near|far|left|right, dur, ease, arm, show};
// {left: {x, y}, right: {x, y}} (or near / far) each hand its own point; null, or {hand, release: true}, lets go.
function gripEntries(g, t) {
  const one = (o, hand) => {
    const v = o && !o.release && (typeof o.x === 'number' || typeof o.y === 'number') ? { x: num(o.x, 0.5), y: num(o.y, 0.5) } : null;
    const arm = o?.arm === false || o?.arm === 'none' ? 'none' : o?.arm === 'upper' || o?.arm === 'noForearm' ? 'upper' : null;
    return { t, hand, v, dur: Math.max(0, num(o?.dur, 0)), ease: EASES.has(o?.ease) ? o.ease : 'inOut', arm, show: o?.show ?? (arm ? 'fist' : null) };
  };
  if (!g) return [one(null, 'both')];
  const parts = ['left', 'right', 'near', 'far'].filter((k) => g[k] !== undefined);
  if (parts.length) return parts.map((k) => one(g[k] ? { dur: g.dur, ease: g.ease, arm: g.arm, show: g.show, ...g[k] } : { release: true, dur: g.dur }, k));
  return [one(g, g.hand || 'both')];
}

const easeK = (name, k) => ease[name || 'inOut'](clamp(k));

// Value of a held gaze at time t: {x, y}, or null when no gaze was ever set.
function lookAt(A, t) {
  let val = null, from = { x: 0, y: 0 }, prev = null;
  const at = (e, time) => (e.dur > 0 ? lerpPt(e.from, e.v, ease.inOut(clamp((time - e.t) / e.dur))) : e.v);
  for (const e of A.looks) {
    if (e.t > t) break;
    from = prev ? at(prev, e.t) : from;
    prev = { ...e, from };
  }
  if (prev) val = at(prev, t);
  return val;
}

// Timed changes of any drawing option: tween: [{key, to, from, at|word, dur, ease}].
function normTween(list, shot, words) {
  if (!Array.isArray(list)) return null;
  const out = list.filter((q) => q && q.key).map((q) => ({ key: String(q.key), to: q.to, from: q.from, t: resolveAt(q, shot, words), dur: num(q.dur, 0), ease: EASES.has(q.ease) ? q.ease : 'inOut' })).sort((a, b) => a.t - b.t);
  return out.length ? out : null;
}
function tweenValues(p, lt) {
  if (!p._tween) return null;
  const v = {};
  const cur = {};
  for (const q of p._tween) {
    const from = q.from ?? cur[q.key] ?? p[q.key] ?? 0;
    if (lt < q.t) { if (!(q.key in v)) v[q.key] = from; continue; }
    const k = q.dur > 0 ? ease[q.ease]((lt - q.t) / q.dur) : 1;
    v[q.key] = typeof q.to === 'number' && typeof from === 'number' ? lerp(from, q.to, k) : k >= 1 ? q.to : from;
    cur[q.key] = q.to;
  }
  return v;
}

// Move target height: a number is the feet's screen y (0..1); 'ground' (or null) returns
// to the actor's normal footing (its floor, or the surface it stands or sits on).
function moveY(v, st) {
  if (v === null || v === 'ground' || v === 'floor') return null;
  return typeof v === 'number' && isFinite(v) ? clamp(v, 0, 1) * st.H : undefined;
}

function compileActor(a, shot, ctx, index, count) {
  const castDef = ctx.cast[a.id] || {};
  const st = ctx.stage;
  const defaultX = count === 1 ? 0.5 : 0.3 + (index / Math.max(1, count - 1)) * 0.4;
  const sit = typeof a.sit === 'string' && a.sit ? a.sit : null;
  let pose0 = POSES[a.pose] ? a.pose : 'stand';
  if (sit && (!a.pose || a.pose === 'stand')) pose0 = 'sit';
  const A = {
    id: a.id,
    color: a.color || castDef.color || SIGNATURE[hash(a.id) % SIGNATURE.length],
    wear: a.wear || castDef.wear || [],
    scale: num(a.scale, 1) * (castDef.kid || a.kid ? 0.72 : 1) * num(castDef.scale, 1),
    march: !!a.march,
    noFace: a.noFace ?? castDef.noFace ?? false,
    lineWeight: num(a.lineWeight, num(castDef.lineWeight, 0)),
    glow: a.glow ?? castDef.glow ?? 0,
    lineColor: a.lineColor || castDef.lineColor || null,
    weight: num(a.weight, num(castDef.weight, 1)),
    ride: typeof a.ride === 'string' && a.ride ? a.ride : null,
    reveal: normReveal(a.reveal, shot, ctx.words, 0),
    carries: [{ t: -9, v: a.carry || null, dur: null }],
    grips: gripEntries(a.grip || null, -9),
    holdSize: num(a.holdSize, 0.42),
    holdMeta: [{ t: -9, opts: a.holdOpts && typeof a.holdOpts === 'object' ? a.holdOpts : null, size: num(a.holdSize, 0.42), hand: a.holdHand || null, style: a.holdStyle || null }],
    looks: parseLook(a.look) ? [{ t: -9, v: parseLook(a.look), dur: 0 }] : [],
    hairColor: a.hairColor || castDef.hairColor || null,
    scarf: a.scarf || castDef.scarf || null,
    depth: a.depth === 'back' ? 'back' : 'front',
    x0: clamp(num(a.x, defaultX), -0.3, 1.3),
    y: num(a.y, null),
    on: typeof a.on === 'string' && a.on ? a.on : typeof a.y === 'string' && a.y ? a.y : null,
    sit,
    lift: num(a.lift, 0),
    seed: hash(a.id) % 97,
    poses: [{ t: -9, v: pose0 }],
    moods: [{ t: -9, v: a.mood || 'neutral' }],
    faces: [{ t: -9, v: a.face || null }],
    holds: [{ t: -9, v: a.hold || null }],
    talks: [{ t: -9, v: !!a.talk }],
    withs: [{ t: -9, v: normWith(a.with) }],
    says: [],
    moves: [],
    jumps: [],
    rim: a.rim,
  };
  const events = (Array.isArray(a.do) ? a.do : []).map((d) => ({ ...d, _t: resolveAt(d, shot, ctx.words) })).sort((p, q) => p._t - q._t);
  let x = A.x0, busyUntil = 0;
  for (const e of events) {
    const t = e._t;
    if (e.pose && POSES[e.pose]) A.poses.push({ t, v: e.pose, dur: num(e.poseDur, null), ease: EASES.has(e.poseEase) ? e.poseEase : null });
    // a collapse: knees bend with the feet planted, the head goes down, then the legs fold into the pose
    if (e.legsFold) A.poses.push({ t, v: POSES[e.legsFold] ? e.legsFold : 'kneelDown', dur: Math.max(0.1, num(e.dur, 0.9)), ease: 'inOut', fold: true });
    if (e.mood) A.moods.push({ t, v: e.mood });
    if (e.face) A.faces.push({ t, v: e.face });
    if ('look' in e) { const v = parseLook(e.look); if (v) A.looks.push({ t, v, dur: Math.max(0, num(e.lookDur, LOOK_EASE)) }); }
    if ('hold' in e || 'holdOpts' in e || 'holdSize' in e || 'holdHand' in e || 'holdStyle' in e) {
      const m0 = A.holdMeta[A.holdMeta.length - 1], item0 = A.holds[A.holds.length - 1].v;
      const same = !('hold' in e) || e.hold === item0;
      A.holdMeta.push({ t, opts: 'holdOpts' in e ? e.holdOpts || null : same ? m0.opts : null, size: num(e.holdSize, m0.size), hand: e.holdHand ?? m0.hand, style: e.holdStyle ?? m0.style });
    }
    if ('hold' in e) A.holds.push({ t, v: e.hold || null });
    if ('talk' in e) A.talks.push({ t, v: !!e.talk });
    if ('with' in e) A.withs.push({ t, v: normWith(e.with) });
    if ('carry' in e) A.carries.push({ t, v: e.carry || null, dur: num(e.liftDur, null) });
    if ('grip' in e) A.grips.push(...gripEntries(e.grip || null, t));
    if (e.say) {
      const words = String(e.say).split(/\s+/).length;
      A.says.push({ t, text: String(e.say), until: num(e.until, t + Math.max(1.4, words * 0.3 + 0.6)) }); // long enough to read
    }
    if (e.jump) A.jumps.push(t);
    let target = null, gait = 'walk';
    if (typeof e.walkTo === 'number') target = e.walkTo;
    if (typeof e.runTo === 'number') { target = e.runTo; gait = 'run'; }
    if (typeof e.moveTo === 'number') { target = e.moveTo; gait = 'glide'; }
    if (e.exit === 'left' || e.exit === 'right') { target = e.exit === 'left' ? -0.18 : 1.18; gait = e.run ? 'run' : 'walk'; }
    let y1 = 'y' in e ? moveY(e.y, st) : undefined;
    const released = 'with' in e && !normWith(e.with);
    if (released && y1 === undefined) y1 = null; // set down: settle onto the floor / surface
    const easing = EASES.has(e.ease) ? e.ease : null;
    if (target != null) {
      target = clamp(target, -0.3, 1.3);
      const back = !!(e.back || e.keepFace);
      // a smaller figure takes smaller steps, so it covers the ground a little slower
      const speed = (gait === 'glide' ? 420 : GAITS[gait].speed * Math.sqrt(A.scale) * (back ? BACK_SPEED : 1)) * st.figScale;
      const t0 = Math.max(t, busyUntil);
      const md = num(e.dur, Math.max(0.25, (Math.abs(target - x) * st.W) / speed));
      A.moves.push({ t0, t1: t0 + md, x0: x, x1: target, gait, ease: easing, ySet: y1 !== undefined, y1: y1 ?? null, open: target < -0.05 || target > 1.05, dir: target >= x ? 1 : -1, back });
      x = target;
      busyUntil = t0 + md;
    } else if (y1 !== undefined) {
      // a height change on the spot (lifted up, set down)
      const t0 = Math.max(t, busyUntil);
      const md = num(e.dur, 0.35);
      A.moves.push({ t0, t1: t0 + md, x0: x, x1: null, gait: 'glide', ease: easing, ySet: true, y1 });
      busyUntil = t0 + md;
    }
  }
  // Default facing: toward the other actors, or the middle of the frame.
  A.defaultFace = null;
  return A;
}

const last = (track, t) => { let v = track[0]; for (const e of track) { if (e.t <= t) v = e; else break; } return v; };
const atTrack = (track, t) => last(track, t).v;
const prevOf = (track, e) => { const i = track.indexOf(e); return i > 0 ? track[i - 1] : e; };

function compileShot(s, i, ctx) {
  const st = ctx.stage;
  const start = num(s.start, 0), end = Math.max(start + 0.2, num(s.end, start + 3));
  const shot = { id: s.id || `s${i + 1}`, start, end };
  // time inside the shot once a freeze is applied
  shot.fz = (lt) => { const F = shot.freeze; return !F || lt <= F.at ? lt : F.until != null && lt > F.until ? lt - (F.until - F.at) : F.at; };
  const setId = SETS[s.set] ? s.set : 'void';
  shot.set = setId;
  shot.light = s.light || SETS[setId].light;
  shot.seed = hash(shot.id + start.toFixed(2));
  shot.transition = s.transition || s.in || 'cut';
  shot.transitionDur = num(s.transitionDur, null);
  shot.hide = Array.isArray(s.hide) && s.hide.length ? new Set(s.hide.map(String)) : null;
  shot.bars = !!s.bars;
  shot.captions = s.captions !== false;
  shot.boardText = s.boardText || '';
  const cam = s.camera || {};
  // an explicit target: {x, y, zoom} in stage fractions, optionally moving to {x, y, zoom, at|word, dur, ease}
  const free = typeof cam.x === 'number' || typeof cam.y === 'number' || (cam.to && typeof cam.to === 'object');
  let camTo = null;
  if (free && cam.to && typeof cam.to === 'object') {
    const t0 = cam.to.at != null || cam.to.word ? resolveAt(cam.to, shot, ctx.words) : 0;
    camTo = { x: num(cam.to.x, null), y: num(cam.to.y, null), zoom: num(cam.to.zoom, null), t: t0, dur: Math.max(0.01, num(cam.to.dur, end - start - t0)), ease: EASES.has(cam.to.ease) ? cam.to.ease : 'inOut' };
  }
  shot.camera = {
    shot: cam.shot || 'wide',
    on: cam.on ?? null,
    move: cam.move || (free ? 'lock' : 'push'),
    free: free ? { x: num(cam.x, 0.5), y: num(cam.y, 0.5), zoom: num(cam.zoom, 1), to: camTo } : null,
    zoom: num(cam.zoom, null),
    dx: num(cam.dx, 0),
    dy: num(cam.dy, 0),
    amount: num(cam.amount, null),
    shake: clamp(num(cam.shake, 0), 0, 1),
    roll: num(cam.roll, 0),
    fit: cam.fit !== false,
  };
  const actors = (Array.isArray(s.actors) ? s.actors : []).filter((a) => a && a.id).slice(0, CAPS.actors);
  shot.actors = actors.map((a, k) => compileActor(a, shot, ctx, k, actors.length));
  for (const A of shot.actors) {
    if (A.faces[0].v) continue;
    const others = shot.actors.filter((o) => o !== A);
    const tx = others.length ? others.reduce((m, o) => m + o.x0, 0) / others.length : 0.5;
    A.defaultFace = Math.abs(tx - A.x0) < 0.02 ? (others.length ? 1 : 'front') : tx > A.x0 ? 1 : -1;
  }
  shot.props = (Array.isArray(s.props) ? s.props : []).filter((p) => p && PROPS[p.type]).slice(0, CAPS.props).map((p) => {
    const at = p.at != null || p.word ? resolveAt(p, shot, ctx.words) : -1;
    const wordT = (w) => { const wt = w ? findWordTime(ctx.words, w, shot.start, shot.end) : null; return wt != null ? wt - shot.start : null; };
    // a plain line draws in its own color and width, with no tip unless one is asked for
    let rv = p.reveal;
    if (p.type === 'line' && rv != null && rv !== false) {
      const o = typeof rv === 'object' ? rv : { dur: num(rv, 1.5) };
      rv = { tip: 'none', color: p.color, width: num(p.width, 4), ...o };
    }
    let t0 = at >= 0 ? at : 0, path = null;
    if (Array.isArray(p.path) && p.path.length) {
      path = p.path.filter((q) => q && typeof q === 'object').map((q) => {
        const t = q.at != null || q.word ? resolveAt(q, shot, ctx.words) : t0;
        const d = Math.max(0, num(q.dur, 0.6));
        t0 = t + d;
        return { t, dur: d, x: num(q.x, null), y: num(q.y, null), ease: EASES.has(q.ease) ? q.ease : 'inOut' };
      });
    }
    return {
      ...p,
...(p.type === 'line' || p.type === 'glow' ? { pop: false } : null),
      ground: isGroundProp(p.type) && p.float !== true,
      _at: at,
      _until: resolveUntil(p, shot, ctx.words, Math.max(0, at)),
      _hardUntil: typeof p.hardUntil === 'number' ? p.hardUntil : wordT(p.hardUntilWord),
      _moveT: typeof p.moveAt === 'number' ? p.moveAt : wordT(p.moveWord),
      _path: path,
      size: num(p.size, 1),
      x: num(p.x, 0.5),
      with: normWith(p.with),
      _reveal: normReveal(rv, shot, ctx.words, at),
      _tween: normTween(p.tween, shot, ctx.words),
    };
  });
  // "carry": lift another actor or a prop into both arms. The carried thing is tied to the carrier.
  for (const A of shot.actors) {
    for (const e of A.carries) {
      if (e.t < -1 && !e.v) continue;
      const B = shot.actors.find((o) => o.id === e.v && o !== A);
      if (B) {
        B.withs.push({ t: e.t, v: { id: A.id, prop: null, dx: 0, dy: 0, walk: false, turn: true, carry: true, liftDur: e.dur } });
        // a set lift duration: the hands reach first, then the body rises and gathers into the arms
        if (e.dur != null && e.t > -1) B.poses.push({ t: e.t + e.dur * 0.3, v: 'carried', dur: e.dur * 0.7, ease: 'inOut' });
        else B.poses.push({ t: e.t, v: 'carried' });
      } else if (e.v) {
        const q = shot.props.find((o) => o.type === e.v);
        if (q) (q._carry ||= []).push({ t: e.t, by: A.id, dur: e.dur });
      }
      const next = A.carries[A.carries.indexOf(e) + 1];
      if (next && e.v) {
        if (B) {
          B.withs.push({ t: next.t, v: null });
          B.poses.push({ t: next.t, v: atTrack(B.poses.filter((q) => q.v !== 'carried'), next.t) });
          B.moves.push({ t0: next.t, t1: next.t + 0.35, x0: 0, x1: null, gait: 'glide', ease: null, ySet: true, y1: null });
        } else {
          const q = shot.props.find((o) => o.type === e.v);
          if (q) q._carry.push({ t: next.t, by: null });
        }
      }
    }
  }
  for (const A of shot.actors) { A.withs.sort((a, b) => a.t - b.t); A.poses.sort((a, b) => a.t - b.t); A.moves.sort((a, b) => a.t0 - b.t0); }
  // A rider takes the ride pose.
  for (const A of shot.actors) if (A.ride) A.poses = [{ t: -9, v: 'ride' }];
  // A seated actor is kept on its seat: x is clamped into the nearest seat's extent.
  for (const A of shot.actors) {
    if (!A.sit || A.withs[0].v) continue;
    let best = null;
    for (const p of shot.props) {
      if (p.type !== A.sit || p.with || !p.ground) continue;
      const sf = propSurface(p.type, !!p.flip);
      if (!sf) continue;
      const sc = p.size * st.propScale * (PROPS[p.type].k || 1);
      const lo = p.x + (sf.x0 * sc) / st.W, hi = p.x + (sf.x1 * sc) / st.W;
      const d = A.x0 < lo ? lo - A.x0 : A.x0 > hi ? A.x0 - hi : 0;
      if (!best || d < best.d) best = { d, lo, hi };
    }
    if (best && best.d > 0) {
      const m = Math.min((best.hi - best.lo) * 0.25, (24 * st.figScale) / st.W);
      A.x0 = clamp(A.x0, best.lo + m, best.hi - m);
    }
  }
  shot.overlays = (Array.isArray(s.text) ? s.text : Array.isArray(s.overlays) ? s.overlays : []).filter((o) => o && o.type).slice(0, CAPS.text).map((o) => {
    const at = resolveAt(o, shot, ctx.words);
    return { ...o, _at: at, _until: resolveUntil(o, shot, ctx.words, at) };
  });
  shot.fx = (Array.isArray(s.fx) ? s.fx : []).map((f) => (typeof f === 'string' ? { type: f } : f)).filter((f) => f && f.type).map((f) => {
    const at = f.at != null || f.word ? resolveAt(f, shot, ctx.words) : 0;
    return { ...f, _at: at, _until: resolveUntil(f, shot, ctx.words, at) };
  });
  const fr = shot.fx.find((f) => f.type === 'freeze');
  // freeze: holds actors, props, particles and the camera at "at". hero: an actor who keeps moving
  // (default the first actor; false = nobody). until: resumes. tint: false keeps the colours.
  shot.freeze = fr ? { at: fr._at, until: fr._until, hero: fr.hero === false ? null : fr.hero || shot.actors[0]?.id, all: fr.hero === false, tint: fr.tint !== false, sparkles: fr.sparkles !== false && fr.tint !== false } : null;
  shot.sfx = (Array.isArray(s.sfx) ? s.sfx : []).map((x) => (typeof x === 'string' ? { sound: x } : x)).filter((x) => x && (x.sound || x.name)).map((x) => ({
    sound: x.sound || x.name,
    t: start + resolveAt(x, shot, ctx.words),
    vol: num(x.vol, 1),
    gain: num(x.gain, 0),
    pan: num(x.pan, 0),
    duck: typeof x.duck === 'boolean' ? x.duck : undefined,
  }));
  return shot;
}

export function compileFilm(story = {}, meta = {}) {
  const stage = stageFor(meta.aspect || story.aspect || '16:9');
  const words = meta.words || [];
  const cast = {};
  (story.cast || []).forEach((c, i) => {
    if (!c || !c.id) return;
    cast[c.id] = { ...c, color: c.color || SIGNATURE[i % SIGNATURE.length], wear: Array.isArray(c.wear) ? c.wear : c.wear ? [c.wear] : [] };
  });
  const ctx = { stage, words, cast };
  const shots = (story.shots || []).map((s, i) => compileShot(s, i, ctx)).sort((a, b) => a.start - b.start);
  const duration = Math.max(num(meta.duration, 0), shots.length ? shots[shots.length - 1].end : 0);
  return {
    ...stage,
    look: meta.look || story.look || 'ember',
    duration,
    cast,
    shots,
    words,
    captions: meta.captions ? buildCaptionChunks(words) : null,
    sfx: shots.flatMap((s) => s.sfx),
  };
}

export function shotIndexAt(film, t) {
  const S = film.shots;
  if (!S.length) return -1;
  let lo = 0, hi = S.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (S[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// ---------- per-frame state ----------
// Where a prop is at local time lt. base = {x, y} replaces the authored position (props
// that follow an actor). Returns stage-space placement plus the pop/fade state.
function placeProp(p, lt, V, base) {
  const S = V.propScale;
  const restX = base ? base.x : p.x * V.W;
  const restY = base ? base.y : p.ground ? (p.y != null ? p.y * V.H : V.GY) : num(p.y, 0.38) * V.H;
  let x = restX, y = restY;
  const tv = tweenValues(p, lt);
  let size = num(tv?.size, p.size) * S * (PROPS[p.type].k || 1);
  let rot = 0;
  const a = lt - Math.max(0, p._at);
  // a "to" move may wait: delay (seconds after the cue), or moveAt / moveWord (shot time)
  const aMove = p._moveT != null ? lt - p._moveT : a - num(p.delay, 0);
  let moveDur = 0, move = null, travelDir = 0;
  const def = PROPS[p.type];
  if (!base && p._path) {
    let px = restX, py = restY;
    for (const q of p._path) {
      const tx = q.x != null ? q.x * V.W : px, ty = q.y != null ? q.y * V.H : py;
      if (lt < q.t) break;
      if (tx !== px) travelDir = tx > px ? 1 : -1;
      if (lt >= q.t + q.dur) { px = tx; py = ty; continue; }
      const m = ease[q.ease](clamp((lt - q.t) / q.dur));
      if (def.speed) move = { d: Math.abs(lerp(px, tx, m) - px) / size, D: Math.abs(tx - px) / size, dir: travelDir || 1 };
      px = lerp(px, tx, m); py = lerp(py, ty, m);
      break;
    }
    x = px; y = py;
  } else if (!base && p.to && typeof p.to.x === 'number') {
    const D = Math.abs(p.to.x * V.W - restX);
    moveDur = num(p.dur, def.speed ? Math.max(0.3, D / (def.speed * size)) : 1.2);
    const fn = EASES.has(p.ease) ? ease[p.ease] : def.speed ? rampEase(moveDur, 'walk') : ease.inOut;
    const m = fn(clamp(aMove / moveDur));
    x = lerp(x, p.to.x * V.W, m);
    if (typeof p.to.y === 'number') y = lerp(y, p.to.y * V.H, m);
    travelDir = p.to.x * V.W >= restX ? 1 : -1;
    // distance covered, in the prop's own units: gaits and rolling wheels run off this
    if (def.speed) move = { d: Math.abs(x - restX) / size, D: D / size, dir: travelDir };
  }
  switch (p.anim) {
    case 'float': y += Math.sin(lt * 2 + p.x * 9) * 14; break;
    case 'spin': rot = lt * 2; break;
    case 'pulse': size *= 1 + Math.max(0, Math.sin(lt * 6)) * 0.08; break;
    case 'shake': x += Math.sin(lt * 50) * 4; break;
    case 'bounce': y -= Math.abs(Math.sin(lt * 5)) * 40; break;
    case 'fall': y = lerp(-0.2 * V.H, y, ease.out(clamp(a / 0.6))); break;
    case 'grow': size *= ease.outBack(clamp(a / 0.8)); break;
    case 'fly': {
      if (moveDur) {
        // with a "to" path, fly away only once the move has arrived (eased take-off)
        const b = Math.max(0, aMove - moveDur), r = 0.4;
        const d = b < r ? (b * b) / (2 * r) : b - r / 2;
        x += d * 300; y -= d * 80;
      } else { x += a * 300; y -= a * 80; }
      break;
    }
    default: break;
  }
  const visible = !(p._at >= 0 && lt < p._at);
  const k = p._at >= 0 ? clamp((lt - p._at) / 0.3) : 1;
  let alpha = 1;
  if (p._until != null) alpha = clamp((p._until + 0.2 - lt) / 0.2);
  // pop:false appears without the scale pop: a short fade when cued mid-shot, none at a cut
  if (p.pop === false && p._at > 0 && !p.hardAt) alpha *= clamp((lt - p._at) / 0.2);
  // hardUntil: gone at once, with no fade
  if (p._hardUntil != null && lt >= p._hardUntil) alpha = 0;
  const pop = p._at >= 0 && p.anim !== 'fall' && p.pop !== false && !p.hardAt ? ease.outBack(k) : 1;
  return { x, y, size, rot, flip: !!p.flip, alpha, pop, visible, rest: { x: restX, y: restY }, move, travelDir };
}

// Resolves every actor and prop of a shot at local time lt, in dependency order
// (an actor or prop "with" another follows it; surfaces need the props under them).
function makeScene(shot, lt, V) {
  const byId = new Map(shot.actors.map((A) => [A.id, A]));
  const mMemo = new Map(), sMemo = new Map(), pMemo = new Map();
  const busyM = new Set(), busyS = new Set(), busyP = new Set();
  const tOf = (A) => (shot.freeze && A.id !== shot.freeze.hero ? shot.fz(lt) : lt);
  const ltP = shot.freeze?.all ? shot.fz(lt) : lt;
  const leaderOf = (w, self) => {
    if (!w) return null;
    if (w.id && byId.has(w.id) && byId.get(w.id) !== self) return { actor: byId.get(w.id) };
    const type = w.prop || w.id;
    const p = type ? shot.props.find((q) => q.type === type && q !== self) : null;
    return p ? { prop: p } : null;
  };
  // leader position for followers: {x, f, moving} (x phase) and y (full phase)
  const leadX = (L) => {
    if (L.actor) { const m = motion(L.actor); return m ? { x: m.x, f: m.f, moving: m.moving } : null; }
    const pl = place(L.prop);
    return pl ? { x: pl.x, f: pl.flip ? -1 : 1, moving: null } : null;
  };
  const leadY = (L) => {
    if (L.actor) { const s = state(L.actor); return s ? s.y : null; }
    const pl = place(L.prop);
    return pl ? pl.y : null;
  };

  // Facing: the direction of travel while moving and after arriving, until a later "face" event.
  // A backward step (back: true) keeps whatever facing the figure had.
  function facing(A, tA, moving) {
    if (moving && !moving.back) return moving.dir > 0 ? 1 : -1;
    const fe = last(A.faces, tA);
    let done = null;
    for (const m of A.moves) if (m.x1 != null && !m.back && m.t1 <= tA) done = m;
    if (done && done.t0 > fe.t) return done.dir;
    const face = fe.v;
    return face === 'right' ? 1 : face === 'left' ? -1 : face === 'front' ? 0 : A.defaultFace === 'front' ? 0 : A.defaultFace || 1;
  }
  const faceAt = (A, tA) => {
    for (const m of A.moves) if (m.x1 != null && !m.back && tA >= m.t0 && tA < m.t1) return m.dir;
    return facing(A, tA, null);
  };
  // The turn in progress: {from, k} over TURN seconds after the facing changed.
  function turning(A, tA, f) {
    const points = [...A.faces.map((e) => e.t), ...A.moves.flatMap((m) => (m.x1 != null ? [m.t0, m.t1] : []))].filter((c) => c <= tA && c > tA - TURN && c >= 0);
    let best = null;
    for (const c of points) { const from = faceAt(A, c - 1e-4); if (from !== faceAt(A, c) && (best == null || c > best.c)) best = { c, from }; }
    return best && best.from !== f ? { from: best.from, k: ease.inOut((tA - best.c) / TURN) } : null;
  }
  const rideProp = (A) => (A.ride ? shot.props.find((q) => q.type === A.ride) : null);
  // Where a carrier's arms hold things: {x, y} (world) of the cradle, from its actual hips.
  function cradle(L) {
    const s = state(L);
    if (!s) return null;
    const J = solve(s.pose, s.f);
    return { x: s.x + (s.f || 1) * CRADLE.x * s.scale, y: s.y + (J.hip.y + CRADLE.y) * s.scale, f: s.f || 1, scale: s.scale, s };
  }
  // Blend a carried thing from where it was into the arms over LIFT seconds. With a set duration
  // the hands get there first (the first 30%), then the thing rises (the rest).
  const liftK = (t, t0, dur) => (dur != null ? easeK('inOut', (t - t0 - dur * 0.3) / (dur * 0.7)) : ease.inOut((t - t0) / LIFT));
  const liftFrom = (A, t0, read, dur) => {
    if (t0 <= 1e-3 || tOf(A) >= t0 + (dur ?? LIFT)) return null;
    const o = makeScene(shot, Math.max(0, t0 - 1e-3), V);
    return { from: read(o), k: liftK(tOf(A), t0, dur) };
  };
  // The grip hands at time t. Each hand keeps its target; a "dur" moves it there from where it was.
  function gripsAt(A, tA) {
    const hits = (e, key) => {
      if (e.hand === 'both') return true;
      return (e._arm ||= armKey(faceAt(A, e.t), e.hand)) === key;
    };
    const evalHand = (p, t) => {
      const e = p.e, k = e.dur > 0 ? easeK(e.ease, (t - e.t) / e.dur) : 1;
      if (e.v) return { pos: p.before.pos ? lerpPt(p.before.pos, e.v, k) : e.v, w: p.before.pos ? lerp(p.before.w, 1, k) : k, both: e.hand === 'both', arm: e.arm, show: e.show };
      return { pos: p.before.pos, w: p.before.w * (1 - k), both: p.before.both, arm: k < 1 ? p.before.arm : null, show: k < 1 ? p.before.show : null };
    };
    const out = {};
    for (const key of ['la', 'ra']) {
      let prev = null;
      for (const e of A.grips) {
        if (e.t > tA) break;
        if (!hits(e, key)) continue;
        prev = { e, before: prev ? evalHand(prev, e.t) : { pos: null, w: 0 } };
      }
      if (prev) { const h = evalHand(prev, tA); if (h.pos && h.w > 0) out[key] = h; }
    }
    return out;
  }

  // horizontal motion (and pending height changes) of an actor
  function motion(A) {
    if (mMemo.has(A)) return mMemo.get(A);
    if (busyM.has(A)) return null;
    busyM.add(A);
    const tA = tOf(A);
    let res = null;
    const wEntry = last(A.withs, tA);
    if (wEntry.v) {
      const L = leaderOf(wEntry.v, A);
      const lx = L ? leadX(L) : null;
      if (lx && wEntry.v.carry && L.actor) {
        const C = motion(L.actor);
        res = { x: lx.x, f: C.f || 1, moving: null, attached: { w: wEntry.v, L, carry: true, t0: wEntry.t }, tA };
      } else if (lx) {
        const dir = wEntry.v.turn && lx.f < 0 ? -1 : 1;
        const moving = wEntry.v.walk && lx.moving ? lx.moving : null;
        const f = wEntry.v.walk && lx.f != null ? lx.f : facing(A, tA, null);
        res = { x: lx.x + wEntry.v.dx * V.W * dir, f, moving, attached: { w: wEntry.v, L }, tA };
      }
    }
    if (!res) {
      let x = A.x0 * V.W, yv, yI = null, moving = null, from = -Infinity;
      const wi = A.withs.indexOf(wEntry);
      if (!wEntry.v && wi > 0 && A.withs[wi - 1].v && wEntry.t > 1e-3) {
        // released: continue from where the leader left it
        const rel = makeScene(shot, Math.max(0, wEntry.t - 1e-3), V).state(A);
        if (rel) { x = rel.x; yv = rel.y; from = wEntry.t; }
      }
      for (const m of A.moves) {
        if (m.t0 < from - 1e-6) continue;
        if (tA >= m.t1) { if (m.x1 != null) x = m.x1 * V.W; if (m.ySet) yv = m.y1 ?? undefined; }
        else if (tA >= m.t0) {
          const k = (tA - m.t0) / (m.t1 - m.t0);
          const e = (m.ease ? ease[m.ease] : m.gait === 'glide' ? ease.inOut : rampOf(m))(k);
          const xa = x;
          if (m.x1 != null) {
            const D = Math.abs(m.x1 * V.W - xa);
            x = lerp(xa, m.x1 * V.W, e);
            moving = { ...m, k, dir: m.x1 * V.W > xa ? 1 : -1, d: D * e, D };
          }
          if (m.ySet) yI = { a: yv, b: m.y1 ?? undefined, e };
          break;
        } else break;
      }
      res = { x, yv, yI, moving, f: facing(A, tA, moving), tA };
      // a rider goes where the ride goes
      const rp = rideProp(A);
      if (rp) {
        const pl = place(rp);
        if (pl) { res.ride = { p: rp, pl, rig: rideRig(rp.type, { ...rp, ...tweenValues(rp, ltP), _move: pl.move }, tA) }; res.f = pl.flip ? -1 : 1; res.x = pl.x + res.f * res.ride.rig.saddle.x * pl.size; res.moving = null; }
      }
    }
    busyM.delete(A);
    mMemo.set(A, res);
    return res;
  }

  // height of the surface "name" under stage x: feet y in stage px, or null (none there)
  function surfaceAt(name, x, strict, self) {
    const set = SET_SURFACES[name];
    if (set) return shot.set === set.set ? V.GY - set.top * V.figScale : null;
    let best = null;
    for (const p of shot.props) {
      if (p.type !== name || busyP.has(p)) continue;
      const pl = place(p);
      if (!pl) continue;
      const sf = propSurface(p.type, pl.flip);
      if (!sf) continue;
      const u = (x - pl.x) / pl.size;
      let h = null;
      if (u >= sf.x0 && u <= sf.x1) h = sf.top;
      else if (!strict && sf.ramp) {
        const d = u < sf.x0 ? sf.x0 - u : u - sf.x1;
        if (d < sf.ramp) h = sf.top * (1 - d / sf.ramp);
      }
      if (h == null) continue;
      let y = (p.ground ? pl.y : pl.y + (propBox(p.type).h / 2) * pl.size) - h * pl.size;
      if (PROPS[p.type].dip) y += deckDip(x, loadsOn(p.type));
      if (best == null || y < best) best = y;
    }
    return best;
  }

  // who stands on a sagging surface, and how heavy: [{x, w}] in stage px
  function loadsOn(type) {
    const out = [];
    for (const A of shot.actors) {
      if (A.on !== type || busyM.has(A)) continue;
      const m = motion(A);
      if (m) out.push({ x: m.x, w: A.weight });
    }
    return out;
  }
  // the gap of the surface under an actor, in stage px: [x0, x1] or null
  function gapOn(name) {
    const p = name ? shot.props.find((q) => q.type === name && PROPS[q.type].gapped) : null;
    if (!p || typeof p.gap !== 'number') return null;
    const hw = (num(p.gapW, 26) / 2) * (place(p)?.size ?? 1);
    return [p.gap * V.W - hw, p.gap * V.W + hw];
  }

  // full actor state for drawing
  function state(A) {
    if (sMemo.has(A)) return sMemo.get(A);
    if (busyS.has(A)) return null;
    busyS.add(A);
    const m = motion(A);
    const tA = m.tA;
    const st = V;
    const pe = last(A.poses, tA);
    const pp = prevOf(A.poses, pe);
    // pose "walk"/"run" only names the gait of a move; between moves such an actor just stands
    const travels = A.moves.some((q) => q.x1 != null) || !!m.moving;
    const stride = (id) => ((POSES[id].anim === 'walk' || POSES[id].anim === 'run') && travels ? 'stand' : id);
    // a pose change with its own duration starts from wherever the previous change had got to
    const blendedAt = (e, t) => {
      const i = A.poses.indexOf(e);
      if (i <= 0) return POSES[stride(e.v)];
      const pr = A.poses[i - 1];
      const from = e.dur != null ? blendedAt(pr, e.t) : POSES[stride(pr.v)];
      return blendPose(from, POSES[stride(e.v)], e.dur != null ? easeK(e.ease, (t - e.t) / Math.max(0.01, e.dur)) : ease.inOut((t - e.t) / 0.28));
    };
    let pose = pe.dur != null ? blendedAt(pe, tA) : blendPose(POSES[stride(pp.v)], POSES[stride(pe.v)], ease.inOut((tA - pe.t) / 0.28));
    pose = animatePose(pose, tA, A.seed);
    const moving = m.moving;
    const f = m.f;
    // on a seat: the hips stay on it and the legs stay seated, whatever the arms and torso do
    const seated = !!A.sit && !m.ride && surfaceAt(A.sit, m.x, true, A) != null;
    if (seated) {
      pose = OWN_LEGS.has(pe.v) ? { ...pose, sb: pe.v === 'sit' ? 1 : 0 } : { ...pose, ll: [...POSES.sit.ll], rl: [...POSES.sit.rl], rot: 0, air: 0, sb: 1 };
    }
    const heldMeta = last(A.holdMeta, tA);
    const heldArm = heldMeta.hand ? armKey(f, heldMeta.hand) : null;
    // a pose that holds something up raises the arm that has the prop, on either side and in either facing
    if (last(A.holds, tA).v && HOLD_POSES.has(pe.v)) {
      const sw = (q) => armKey(q, heldMeta.hand || 'near') === 'la';
      const tr = m.attached ? null : turning(A, tA, f);
      const w = tr && sw(tr.from) !== sw(f) ? (sw(f) ? tr.k : 1 - tr.k) : sw(f) ? 1 : 0;
      if (w > 0) pose = { ...pose, la: [lerp(pose.la[0], pose.ra[0], w), lerp(pose.la[1], pose.ra[1], w)], ra: [lerp(pose.ra[0], pose.la[0], w), lerp(pose.ra[1], pose.la[1], w)] };
    }
    // a fold: planted feet and bending knees first, then the legs fold under; the head only goes down
    if (pe.fold && tA < pe.t + pe.dur) {
      const k = clamp((tA - pe.t) / pe.dur), bump = Math.sin(Math.PI * k);
      pose = { ...pose, lean: pose.lean + bump * 10, head: pose.head + bump * 14 };
      if (f) {
        const from = POSES[stride(pp.v)], r0 = poseRest(from, f, f), r1 = poseRest(POSES[pe.v], f, f);
        const leg = (ax) => ({ ax, ay: -5.5, tx: ax + BONES.foot, ty: -5.5 });
        pose.ik = { hip: lerp(r0.hip, r1.hip, ease.inOut(k)), ll: leg(r0.feet.ll), rl: leg(r0.feet.rl), w: 1 - smooth((k - 0.5) / 0.5), dir: f };
      }
    }
    const back = A.depth === 'back';
    const scale = st.figScale * A.scale * (back ? 0.72 : 1);
    // footing: floor (or fixed y), raised by a surface it stands on, or by a seat under its hips
    const floorY = A.y != null ? A.y * st.H : st.GY - (back ? 70 * st.figScale : 0);
    let hipH = null;
    const base = (x) => {
      let y = floorY;
      if (A.on) { const s = surfaceAt(A.on, x, false, A); if (s != null) y = Math.min(y, s); }
      if (A.sit) {
        const s = surfaceAt(A.sit, x, true, A);
        if (s != null) {
          if (hipH == null) hipH = -solve({ ...pose, air: 0, bob: 0 }, f).hip.y * scale;
          y = Math.min(y, s + hipH);
        }
      }
      return y - A.lift;
    };
    let y;
    if (m.ride) {
      const { rig, pl } = m.ride;
      y = pl.y;
    } else if (m.attached?.carry) {
      const C = cradle(m.attached.L.actor);
      const J = solve({ ...pose, air: 0, bob: 0 }, f);
      m.x = C.x; y = C.y - J.hip.y * scale;
      const lift = liftFrom(A, m.attached.t0, (o) => o.state(A), m.attached.w.liftDur);
      if (lift?.from) { m.x = lerp(lift.from.x, C.x, lift.k); y = lerp(lift.from.y, y, lift.k); }
    } else if (m.attached) {
      const w = m.attached.w;
      if (A.on || A.sit) y = base(m.x) + w.dy * st.H;
      else { const ly = leadY(m.attached.L); y = (ly ?? floorY) + w.dy * st.H; }
    } else if (m.yI) {
      const ya = m.yI.a ?? base(m.x), yb = m.yI.b ?? base(m.x);
      y = lerp(ya, yb, m.yI.e);
    } else y = m.yv ?? base(m.x);
    // the gait: a walk or run, or a glide whose pose asks for one, steps over the ground
    const heldNow = last(A.holds, tA).v;
    let gaitInfo = null;
    const kind = !moving ? null : moving.gait !== 'glide' ? moving.gait : POSES[pe.v].anim === 'walk' || POSES[pe.v].anim === 'run' ? POSES[pe.v].anim : null;
    if (kind && moving.D > 0.5 && (f === moving.dir || (moving.back && f === -moving.dir))) {
      const dir = moving.dir;
      const p0 = POSES[stride(last(A.poses, moving.t0).v)], p1 = POSES[stride(last(A.poses, moving.t1).v)];
      const r0 = poseRest(p0, m.attached ? f : faceAt(A, moving.t0 - 1e-4), dir), r1 = poseRest(p1, f, dir);
      const memo = (A._plans ||= new Map());
      const xa = m.x - dir * moving.d;
      const gapPx = gapOn(A.on);
      const avoid = gapPx ? [(dir > 0 ? gapPx[0] - xa : xa - gapPx[1]) / scale, (dir > 0 ? gapPx[1] - xa : xa - gapPx[0]) / scale] : null;
      const key = `${scale}|${kind}|${moving.t0}|${moving.D.toFixed(2)}`;
      let plan = memo.get(key);
      if (!plan) memo.set(key, plan = gaitPlan(moving.D / scale, kind, r0.feet, r1.feet, moving.open, avoid));
      const onBase = !m.attached && !m.yI && m.yv == null && (A.on || A.sit);
      const dr = moving.d / scale;
      const ground = onBase ? (q) => (y - base(m.x + dir * (q - dr) * scale)) / scale : undefined;
      const gf = gaitAt(plan, dr, poseRest(pose, f, dir).hip, ground);
      const fadeIn = moving.ease === 'linear' && moving.t0 <= 0 ? 1 : smooth((tA - moving.t0) / 0.32);
      const fadeOut = moving.open ? 1 : smooth((moving.t1 - tA) / 0.32);
      const ikw = Math.min(r0.grounded ? 1 : fadeIn, r1.grounded ? 1 : fadeOut);
      pose = applyGait(pose, gf, Math.min(fadeIn, fadeOut), ikw, dir, { poseId: pe.v, held: heldMeta.style === 'low' ? null : heldNow, heldArm, facing: f });
      gaitInfo = { ll: gf.ll, rl: gf.rl, kind };
    } else if (A.march && !moving && f && (POSES[pe.v].anim === 'walk' || POSES[pe.v].anim === 'run')) {
      const gf = gaitMarch(POSES[pe.v].anim, tA, poseRest(pose, f, f).hip);
      pose = applyGait({ ...pose, la: POSES.stand.la, ra: POSES.stand.ra }, gf, 1, 1, f, { poseId: 'stand', held: heldMeta.style === 'low' ? null : heldNow, heldArm });
    }
    // a rider: hips on the saddle, feet on the pedals, hands on the bars
    if (m.ride) {
      const { rig, pl } = m.ride;
      const sz = pl.size / scale, fs = f || 1;
      const loc = (q) => ({ x: (q.x - rig.saddle.x) * sz, y: q.y * sz });
      const leg = (q) => { const a = loc(q); return { ax: a.x, ay: a.y, tx: a.x + 15, ty: a.y }; };
      pose = { ...pose, ik: { hip: -rig.saddle.y * sz - 5, ll: leg(rig.pedals[0]), rl: leg(rig.pedals[1]), w: 1, dir: fs } };
      const bar = loc(rig.bars);
      pose.armik = { la: { x: bar.x * fs, y: bar.y, w: 1 }, ra: { x: bar.x * fs, y: bar.y, w: 1 } };
    }
    // carrying: both arms reach under what is carried
    const carrying = atTrack(A.carries, tA);
    let held2 = null;
    if (carrying) {
      const c0 = last(A.carries, tA);
      const w = c0.t < 0 ? 1 : c0.dur != null ? easeK('inOut', (tA - c0.t) / (c0.dur * 0.3)) : ease.inOut((tA - c0.t) / LIFT);
      const J0 = solve(pose, f || 1), fs = f || 1;
      const cx = CRADLE.x, cy = J0.hip.y + CRADLE.y;
      const B = byId.get(carrying);
      let a, b; // near and far hands: under the knees, under the back
      if (B) {
        const ks = scaleOf(B, V) / scale, Jb = solve(POSES.carried, fs);
        const Q = (q) => ({ x: cx * fs + (q.x - Jb.hip.x) * ks, y: cy + (q.y - Jb.hip.y) * ks + 7 });
        a = Q({ x: lerp(Jb.rl[0].x, Jb.rl[1].x, 0.65), y: lerp(Jb.rl[0].y, Jb.rl[1].y, 0.65) });
        b = Q({ x: lerp(Jb.hip.x, Jb.neck.x, 0.55), y: lerp(Jb.hip.y, Jb.neck.y, 0.55) });
        // during a timed lift the hands stay under the body: from its knees and back where it lay, up to the cradle
        if (c0.dur != null && c0.t > 1e-3 && tA < c0.t + c0.dur) {
          if (!c0._from) {
            const so = makeScene(shot, c0.t - 1e-3, V).state(B), Jo = solve({ ...so.pose, armik: null }, so.f);
            const Wo = (q) => ({ x: so.x + q.x * so.scale, y: so.y + q.y * so.scale });
            c0._from = { a: Wo(lerpPt(Jo.rl[0], Jo.rl[1], 0.65)), b: Wo(lerpPt(Jo.hip, Jo.neck, 0.55)) };
          }
          const k = liftK(tA, c0.t, c0.dur);
          const go = (q, w0) => { const wq = lerpPt(w0, { x: m.x + q.x * scale, y: y + q.y * scale }, k); return { x: (wq.x - m.x) / scale, y: (wq.y - y) / scale }; };
          a = go(a, c0._from.a); b = go(b, c0._from.b);
        }
      } else {
        const q = shot.props.find((o) => o.type === carrying);
        const sc = q ? (q.size * V.propScale * (PROPS[q.type].k || 1)) / scale : 1;
        a = { x: (cx + 16 * sc + 20 * sc) * fs, y: cy + 16 * sc };
        b = { x: (cx + 16 * sc - 26 * sc) * fs, y: cy + 16 * sc };
      }
      const near = fs >= 0 ? 'ra' : 'la', far = fs >= 0 ? 'la' : 'ra';
      pose = { ...pose, armik: { [near]: { ...a, w }, [far]: { ...b, w } } };
    }
    // gripping fixed points in the stage: both hands on one, or each hand its own
    const hands = gripsAt(A, tA);
    let armMode = null, handMarks = null;
    if (hands.la || hands.ra) {
      const ik = { ...pose.armik };
      for (const key of ['la', 'ra']) {
        const h = hands[key];
        if (!h) continue;
        const off = h.both ? (key === 'la' ? -6 : 6) : 0;
        ik[key] = { x: (h.pos.x * V.W - m.x) / scale + off, y: (h.pos.y * V.H - y) / scale, w: h.w };
        if (h.arm) (armMode ||= {})[key] = h.arm;
        if (h.show && h.show !== 'none' && h.w > 0.5) (handMarks ||= {})[key] = h.show;
      }
      pose = { ...pose, armik: ik };
    }
    // a set gaze nods the head; the face and hat follow it in the drawing
    const look = A.looks.length ? lookAt(A, tA) : null;
    if (look?.y) pose = { ...pose, pitch: look.y * (look.y > 0 ? 30 : 24) };
    // a rider's body stays on the ride, but a "face" event still turns the head
    let headF = null, headTb = null;
    if (m.ride) {
      const fe = last(A.faces, tA);
      const dirOf = (v) => (v === 'right' ? 1 : v === 'left' ? -1 : v === 'front' ? 0 : f);
      if (fe.v) {
        headF = dirOf(fe.v);
        const pv = prevOf(A.faces, fe);
        if (pv !== fe && tA - fe.t < TURN && dirOf(pv.v) !== headF) headTb = { from: dirOf(pv.v), k: ease.inOut((tA - fe.t) / TURN) };
      }
    }
    let air = 0;
    for (const jt of A.jumps) if (tA >= jt && tA < jt + 0.6) air = Math.sin(((tA - jt) / 0.6) * Math.PI) * 110;
    if (air) pose = { ...pose, air: (pose.air || 0) + air };
    const res = {
      x: m.x,
      y,
      scale,
      f,
      pose,
      mood: last(A.moods, tA).v,
      held: heldNow,
      gaitInfo,
      turn: m.attached ? null : turning(A, tA, f),
      talk: last(A.talks, tA).v,
      t: tA,
      back,
      carried: !!(m.attached && m.attached.L.actor),
      riding: !!m.ride,
      seated,
      look,
      headF,
      headTb,
      armMode,
      hands: handMarks,
      holdMeta: heldMeta,
      holdArm: heldArm,
    };
    busyS.delete(A);
    sMemo.set(A, res);
    return res;
  }

  function place(p) {
    if (pMemo.has(p)) return pMemo.get(p);
    if (busyP.has(p)) return null;
    busyP.add(p);
    let base = null, flip = !!p.flip, carried = false;
    // carried in someone's arms: the middle of the body sits in the cradle
    const cre = p._carry ? p._carry.filter((e) => e.t <= lt).pop() : null;
    if (cre) {
      if (cre.by && byId.has(cre.by)) {
        const C = cradle(byId.get(cre.by));
        if (C) {
          const def = PROPS[p.type];
          const size = p.size * V.propScale * (def.k || 1);
          let x = C.x + C.f * 16 * size, y = C.y + (p.ground ? 40 * size : 0);
          if (cre.t > 1e-3 && lt < cre.t + (cre.dur ?? LIFT)) {
            const o = makeScene(shot, Math.max(0, cre.t - 1e-3), V).place(p), k = liftK(lt, cre.t, cre.dur);
            if (o) { x = lerp(o.x, x, k); y = lerp(o.y, y, k); }
          }
          base = { x, y };
          flip = C.f < 0;
          carried = true;
        }
      } else if (cre.t > 1e-3) {
        const o = makeScene(shot, cre.t - 1e-3, V).place(p), k = ease.inOut((lt - cre.t) / 0.35);
        if (o) base = { x: o.x, y: lerp(o.y, p.y != null ? p.y * V.H : V.GY, k) };
      }
    }
    const L = !base && p.with ? leaderOf(p.with, p) : null;
    if (L) {
      const lx = leadX(L);
      if (lx) {
        const dir = p.with.turn && lx.f < 0 ? -1 : 1;
        if (dir < 0) flip = !flip;
        // y follows the leader's feet (a ground prop falls back to its own floor)
        const ly = leadY(L);
        const y = (ly ?? (p.ground && p.y != null ? p.y * V.H : V.GY)) + p.with.dy * V.H;
        base = { x: lx.x + p.with.dx * V.W * dir, y };
      }
    }
    const res = placeProp(p, ltP, V, base);
    // a thing that walks or rolls faces where it is going
    res.flip = PROPS[p.type].speed && res.travelDir ? res.travelDir < 0 : flip;
    if (p._tween?.some((q) => q.key === 'flip')) res.flip = !!tweenValues(p, ltP).flip;
    res.follows = !!base;
    res.carried = carried;
    busyP.delete(p);
    pMemo.set(p, res);
    return res;
  }

  const states = {};
  for (const A of shot.actors) states[A.id] = state(A);
  return { states, state, place, loadsOn };
}

// A scale without a full scene: what state() uses for a figure at its depth.
function scaleOf(A, V) { return V.figScale * A.scale * (A.depth === 'back' ? 0.72 : 1); }

// Framing bounds of a prop in stage space (rest position, plus the end of a "to" path).
function propBounds(p, pl, V) {
  if (p.type === 'line') {
    const all = (Array.isArray(p.lines) ? p.lines.flat() : p.points || []).filter(Array.isArray);
    if (all.length) { const xs = all.map((q) => q[0] * V.W), ys = all.map((q) => q[1] * V.H); return { x0: Math.min(...xs) - 8, x1: Math.max(...xs) + 8, y0: Math.min(...ys) - 8, y1: Math.max(...ys) + 8 }; }
  }
  const b = propBox(p.type), sc = pl.size;
  const pts = [pl.rest];
  if (!pl.follows && p.to && typeof p.to.x === 'number') pts.push({ x: p.to.x * V.W, y: typeof p.to.y === 'number' ? p.to.y * V.H : pl.rest.y });
  const pad = p.anim === 'float' || p.anim === 'bounce' ? 30 : 8;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of pts) {
    const hw = (b.w / 2) * sc + pad;
    const top = p.ground ? q.y - b.h * sc : q.y - (b.h / 2) * sc;
    const bot = p.ground ? q.y : q.y + (b.h / 2) * sc;
    x0 = Math.min(x0, q.x - hw); x1 = Math.max(x1, q.x + hw);
    y0 = Math.min(y0, top - pad); y1 = Math.max(y1, bot + pad);
  }
  return { x0, x1, y0, y1 };
}

// Insert-style framing of one prop: centred on its visual middle; tall ground props zoom
// out (down to 1.3) so they fit the frame height.
function propFrame(p, pl, V, z0) {
  if (p.ground) {
    const hp = propBox(p.type).h * pl.size;
    return { cx: pl.rest.x, cy: pl.rest.y - 0.5 * hp, z: clamp((V.H * 0.85) / hp, Math.min(z0, 1.3), z0) };
  }
  return { cx: pl.follows ? pl.rest.x : p.x * V.W, cy: pl.follows ? pl.rest.y : num(p.y, 0.4) * V.H, z: z0 };
}

function cameraAt(shot, lt, V, states, scene) {
  const { W, H, GY, figScale } = V;
  const c = shot.camera;
  const dur = shot.end - shot.start;
  let cx = W / 2, cy = H / 2, z = 1;
  const ids = c.on == null ? Object.keys(states) : Array.isArray(c.on) ? c.on : [c.on];
  const targets = ids.map((id) => states[id]).filter(Boolean);
  // camera.on that names no actor but a prop frames that prop
  const onProp = c.on != null && !targets.length && c.shot !== 'insert' && c.shot !== 'wide' ? shot.props.find((q) => ids.includes(q.type)) : null;
  const first = targets[0] || (onProp ? null : Object.values(states)[0]);
  const figH = (s) => figureHeight(s.scale);
  let actorBox = null;
  // where a seated figure's head really is (a standing figure is framed from its height, as always)
  const headAt = (s) => { const J = figureJoints(s); return { x: s.x + J.head.x * s.scale, y: s.y + J.head.y * s.scale }; };
  if (c.free) {
    const F = c.free, T = F.to;
    const k = T ? easeK(T.ease, (lt - T.t) / T.dur) : 0;
    cx = lerp(F.x, T?.x ?? F.x, k) * W;
    cy = lerp(F.y, T?.y ?? F.y, k) * H;
    const z0 = Math.max(0.05, F.zoom), z1 = Math.max(0.05, T?.zoom ?? F.zoom);
    z = z0 * Math.pow(z1 / z0, k); // a zoom reads even when it is a constant ratio per second
  } else if (onProp) {
    ({ cx, cy, z } = propFrame(onProp, scene.place(onProp), V, c.shot === 'medium' ? 1.6 : c.shot === 'close' ? 2.2 : 2.6));
  } else if (c.shot === 'medium' && first) {
    // a medium shot keeps everyone near the target in frame (conversations)
    const near = Object.values(states).filter((s) => !s.back && Math.abs(s.x - first.x) < W * 0.5);
    const xs = (targets.length > 1 ? targets : near.length ? near : [first]).map((s) => s.x);
    const span = Math.max(...xs) - Math.min(...xs);
    cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    z = clamp((W * 0.82) / (span + 420 * figScale), 1.15, V.vertical ? 1.7 : 1.9);
    cy = first.y - figH(first) * 0.5;
    actorBox = { x0: Math.min(...xs) - 150 * figScale, x1: Math.max(...xs) + 150 * figScale, y0: first.y - figH(first) * 1.05, y1: first.y + 24 * figScale, zMin: 1.15 };
  } else if (c.shot === 'close' && first) {
    z = V.vertical ? 2.4 : 2.7; cx = first.x; cy = first.y - figH(first) * 0.72;
    let top = first.y - figH(first);
    if (first.seated) { const h = headAt(first); cx = h.x; top = h.y - BONES.head * first.scale; cy = top + figH(first) * 0.28; }
    actorBox = { x0: cx - figH(first) * 0.25, x1: cx + figH(first) * 0.25, y0: top - figH(first) * 0.02, y1: top + figH(first) * 0.55, zMin: V.vertical ? 1.5 : 1.6 };
  } else if (c.shot === 'face' && first) {
    const headD = 2 * BONES.head * first.scale;
    z = clamp((Math.min(W, H) * 0.4) / headD, 2, 12);
    cx = first.x + (first.f || 0) * BONES.head * first.scale * 0.25;
    cy = first.y - figH(first) + BONES.head * first.scale * 1.1;
    if (first.seated) { const h = headAt(first); cx = h.x + (first.f || 0) * BONES.head * first.scale * 0.25; cy = h.y + BONES.head * first.scale * 0.1; }
  } else if (c.shot === 'insert') {
    const p = shot.props.find((q) => q.type === c.on);
    // an insert on an object that an actor is holding frames the holding hand
    const holder = !p && c.on ? Object.values(states).find((s) => s.held === c.on) : null;
    if (holder) {
      z = 2.4; cx = holder.x + (holder.f || 0) * 40 * holder.scale; cy = holder.y - figH(holder) * 0.62;
    } else {
      const q = p || shot.props[0];
      if (q) ({ cx, cy, z } = propFrame(q, scene.place(q), V, 2.6));
    }
  }
  if (c.zoom != null && !c.free) z = Math.max(0.05, c.zoom);
  const amt = c.amount ?? 0.1;
  // medium and close shots widen (within limits) to include props that pop in on a cue
  if (actorBox && c.fit !== false) {
    const boxes = [];
    for (const p of shot.props) {
      if (p.frame === false || !(p.frame === true || (!p.ground && p._at >= 0 && p.type !== 'line' && p.type !== 'glow'))) continue;
      const pl = scene.place(p);
      if (pl) boxes.push(propBounds(p, pl, V));
    }
    if (boxes.length) {
      const U = boxes.reduce((u, b) => ({ x0: Math.min(u.x0, b.x0), x1: Math.max(u.x1, b.x1), y0: Math.min(u.y0, b.y0), y1: Math.max(u.y1, b.y1) }), actorBox);
      const zf = c.move === 'push' || c.move === 'pull' ? 1 + amt : c.move === 'drift' ? 1.05 : c.move === 'static' ? 1.015 : 1.04;
      const panX = c.move === 'left' || c.move === 'right' ? amt * W * 0.5 : c.move === 'drift' ? W * 0.012 : 0;
      const panY = c.move === 'up' || c.move === 'down' ? amt * H * 0.5 : 0;
      const win = (zz) => ({ hw: (W / (2 * zf) - panX) / zz, hh: (H / (2 * zf) - panY) / zz });
      const w0 = win(z);
      const inside = U.x0 >= cx - w0.hw && U.x1 <= cx + w0.hw && U.y0 >= cy - w0.hh && U.y1 <= cy + w0.hh;
      if (!inside) {
        // zoom out only as far as needed, never below the shot's limit (or 65% of its zoom);
        // if the props cannot fit completely, the framing is left as it was
        const zx = (W / (2 * zf) - panX) / ((U.x1 - U.x0) / 2), zy = (H / (2 * zf) - panY) / ((U.y1 - U.y0) / 2);
        const z2 = Math.min(z, zx, zy);
        if (z2 >= Math.min(z, Math.max(actorBox.zMin, z * 0.65)) - 1e-6) {
          const w = win(z2);
          cx = clamp(cx, U.x1 - w.hw, U.x0 + w.hw);
          cy = clamp(cy, U.y1 - w.hh, U.y0 + w.hh);
          z = z2;
        }
      }
    }
  }
  const k = ease.inOut(clamp(lt / Math.max(0.5, dur)));
  switch (c.move) {
    case 'push': z *= lerp(1, 1 + amt, k); break;
    case 'pull': z *= lerp(1 + amt, 1, k); break;
    case 'left': cx += lerp(amt, -amt, k) * W * 0.5 / z; z *= 1.04; break;
    case 'right': cx += lerp(-amt, amt, k) * W * 0.5 / z; z *= 1.04; break;
    case 'up': cy += lerp(amt, -amt, k) * H * 0.5 / z; z *= 1.04; break;
    case 'down': cy += lerp(-amt, amt, k) * H * 0.5 / z; z *= 1.04; break;
    case 'drift': cx += Math.sin(lt * 0.5) * W * 0.012; z *= 1.03 + 0.02 * k; break;
    case 'lock': break;
    default: z *= 1 + 0.015 * k;
  }
  cx += c.dx * W; cy += c.dy * H;
  // keep the frame on the set: never look below the floor too far or above the sky
  z = Math.max(1, z);
  let sx = 0, sy = 0, roll = (c.roll || 0) * Math.PI / 180;
  const shake = Math.max(c.shake || 0, shot.fx.some((f) => f.type === 'shake' && lt >= f._at && (f._until == null || lt <= f._until)) ? 0.6 : 0);
  if (shake) {
    sx = wobble(lt * 18, 1) * 22 * shake;
    sy = wobble(lt * 18, 2) * 16 * shake;
    roll += wobble(lt * 12, 3) * 0.012 * shake;
  }
  return { cx: cx + sx / z, cy: cy + sy / z, z, roll };
}

function applyCam(g, cam, V, d) {
  const { W, H } = V;
  const z = 1 + (cam.z - 1) * d;
  g.translate(W / 2, H / 2);
  if (cam.roll) g.rotate(cam.roll * d);
  g.scale(z, z);
  g.translate(-(W / 2 + (cam.cx - W / 2) * d), -(H / 2 + (cam.cy - H / 2) * d));
}

function project(cam, V, x, y) {
  const { W, H } = V;
  const dx = (x - cam.cx) * cam.z, dy = (y - cam.cy) * cam.z;
  const c = Math.cos(cam.roll), s = Math.sin(cam.roll);
  return { x: W / 2 + dx * c - dy * s, y: H / 2 + dx * s + dy * c };
}

function drawShadow(g, x, y, scale, P) {
  g.save();
  g.translate(x, y + 2);
  g.scale(1, 0.18);
  const r = 70 * scale;
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
  gr.addColorStop(0, css('#000000', P.outline ? 0.18 : 0.42));
  gr.addColorStop(1, css('#000000', 0));
  g.fillStyle = gr;
  g.fillRect(-r, -r, r * 2, r * 2);
  g.restore();
}

function drawBubble(g, text, x, y, V, k) {
  const S = Math.min(V.W, V.H) / 1080;
  const base = 40 * S;
  g.save();
  // Wrap at ~18 characters per line (honouring line breaks); the bubble grows to fit.
  const L = layoutText(g, text, { w: Math.min(V.W * (V.vertical ? 0.6 : 0.32), base * 10), h: base * 1.25 * 4 }, { maxSize: base, minSize: base * 0.7, family: BODY, weight: 700, lineHeight: 1.25, maxLines: 4 });
  const size = L.size, lines = L.lines;
  const w = L.width + size * 1.4;
  const h = L.height + size * 0.9;
  const bx = clamp(x, w / 2 + 20 * S, V.W - w / 2 - 20 * S), by = clamp(y - h / 2 - 40 * S, h / 2 + 20 * S, V.H);
  g.translate(bx, by);
  const sc = ease.outBack(k);
  g.scale(sc, sc);
  g.fillStyle = '#ffffff';
  roundRect(g, -w / 2, -h / 2, w, h, size * 0.7);
  g.fill();
  g.beginPath(); g.moveTo(clamp(x - bx, -w / 3, w / 3) - 14 * S, h / 2 - 2); g.lineTo(x - bx, h / 2 + 30 * S); g.lineTo(clamp(x - bx, -w / 3, w / 3) + 14 * S, h / 2 - 2); g.fill();
  g.fillStyle = '#20202a';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, 0, (i - (lines.length - 1) / 2) * size * 1.25));
  g.restore();
}

// A held prop sits in the hand: at its "grip" point, turned with the figure.
const heldDrawer = (A, P, t, meta) => (gg, item, hx, hy, f) => {
  const k = meta?.size ?? A.holdSize, gp = PROPS[item]?.grip || [0, 0], fs = f || 1;
  const o = meta?.opts || null;
  const opts = { glow: false, ...o, flip: o?.flip ? fs > 0 : fs < 0 };
  if (o?.rotate) {
    // turned about the grip, so the hand stays on the handle: {rotate: degrees, toward the facing}
    gg.save(); gg.translate(hx + fs * 6, hy - 6); gg.rotate((o.rotate * fs * Math.PI) / 180);
    drawProp(gg, item, -fs * gp[0] * k, -gp[1] * k, k, P, t, opts);
    gg.restore();
    return;
  }
  drawProp(gg, item, hx + fs * (6 - gp[0] * k), hy - 6 - gp[1] * k, k, P, t, opts);
};
// The per-frame drawing fields of an actor, shared by every place that draws one.
const figFields = (A, s) => ({ look: s.look, headF: s.headF, headTb: s.headTb, armMode: s.armMode, hands: s.hands, holdArm: s.holdArm, hairColor: A.hairColor, scarf: A.scarf });

function propOpts(p, pl, lt, V, scene) {
  const o = { ...p, ...tweenValues(p, lt), rot: pl.rot, flip: pl.flip, _move: pl.move, _x: pl.x, _y: pl.y, _size: pl.size, _W: V.W, _H: V.H, _lt: lt, carried: pl.carried || p.carried };
  if (o.rotate) o.rot += (o.rotate * Math.PI) / 180;
  if (PROPS[p.type].dip && scene) o._loads = scene.loadsOn(p.type);
  return o;
}

function drawPropInstance(g, p, pl, P, tWorld, lt, V, scene, tips) {
  if (!pl) return;
  const R = p._reveal;
  if (!R && (!pl.visible || pl.alpha <= 0)) return;
  if (p._hardUntil != null && lt >= p._hardUntil) return;
  const o = propOpts(p, pl, lt, V, scene);
  g.save();
  g.globalAlpha = pl.alpha * clamp(num(o.alpha, 1));
  if (R) {
    const res = drawReveal(g, R, lt, (gg) => drawProp(gg, p.type, pl.x, pl.y, pl.size, P, tWorld, o));
    if (res?.tip && tips) tips[p.type] = { ...res.tip, tremble: R.tremble };
    const handOpts = { tool: R.tip === 'chalk' ? 'chalk' : R.tip === 'pen' ? 'pen' : 'pencil', tremble: R.tremble };
    if (R.hand && res?.tip) drawProp(g, 'hand', res.tip.x, res.tip.y, V.propScale, P, tWorld, handOpts);
    else if (R.hand && R.handExit && res?.last) {
      // the hand lifts away and leaves when the drawing is done
      const tEnd = R.steps ? Math.max(...R.steps.map((q) => q.t + q.dur)) : R.at + R.dur * (R.stop ?? 1);
      const k = (lt - tEnd) / R.handExit.dur;
      if (k >= 0 && k < 1) { const e = ease.in(k); drawProp(g, 'hand', res.last.x + e * R.handExit.dx * V.W, res.last.y + e * R.handExit.dy * V.H, V.propScale, P, tWorld, handOpts); }
    }
  } else if (p.type === 'hand' && (p.follow || p.stroke)) {
    drawHand(g, p, pl, P, tWorld, lt, V, o, tips);
  } else if (!(p.type === 'hand' && p.hand === false)) drawProp(g, p.type, pl.x, pl.y, pl.size * pl.pop, P, tWorld, o);
  g.restore();
}

// A hand that follows the end of a revealed drawing, or traces its own line (stroke: [[x, y], ...],
// stage fractions, over "dur" seconds from its cue, leaving the line behind).
function drawHand(g, p, pl, P, tWorld, lt, V, o, tips) {
  let x = pl.x, y = pl.y;
  if (p.stroke) {
    const pts = p.stroke.flatMap((q) => [q[0] * V.W, q[1] * V.H]);
    const sd = num(p.dur, 1.2);
    const k = sd <= 0.002 ? 1 : clamp((lt - Math.max(0, p._at)) / sd);
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    const lc = p.lineColor || p.color;
    const s = [{ pts, len, w: 0, color: lc || null, kind: 'stroke' }];
    const tip = traceStrokes(g, s, len * k, { color: lc || '#fbfbf2', width: num(p.lineWidth, 5) });
    if (tip) { x = tip.x; y = tip.y; }
  } else if (p.follow && tips?.[p.follow]) { x = tips[p.follow].x; y = tips[p.follow].y; }
  if (p.hand !== false) drawProp(g, 'hand', x, y, pl.size * pl.pop, P, tWorld, o);
}

// Render the film at time t (seconds) into a 2D context of any pixel size.
// opts: { width, height, look, env: { createCanvas }, captions }
export function renderFrame(g, film, t, opts = {}) {
  const width = opts.width || g.canvas.width, height = opts.height || g.canvas.height;
  const V0 = film;
  const look = getLook(opts.look || film.look);
  g.setTransform(width / V0.W, 0, 0, height / V0.H, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  const i = opts._shot ?? shotIndexAt(film, t);
  if (i < 0) {
    g.fillStyle = '#111'; g.fillRect(0, 0, V0.W, V0.H);
    return;
  }
  const shot = film.shots[i];
  const lt = clamp(t - shot.start, 0, shot.end - shot.start + 1);
  const P = palette(look.id, shot.light);
  const V = { ...V0, P, t: lt, lookId: look.id };
  const frozen = shot.freeze && lt > shot.freeze.at && (shot.freeze.until == null || lt <= shot.freeze.until);
  const tWorld = shot.fz(lt);

  // actors and props first (the camera needs them)
  const scene = makeScene(shot, lt, V);
  const states = scene.states;
  const cam = cameraAt(shot, shot.freeze?.all ? tWorld : lt, V, states, scene);
  const tips = {};
  const ltD = shot.freeze?.all ? tWorld : lt;
  const dp = (p) => drawPropInstance(g, p, scene.place(p), P, tWorld, ltD, V, scene, tips);
  // transitions that move the camera
  const tr = opts._shot != null ? 'cut' : shot.transition; // the outgoing picture of a dissolve has no transition of its own
  if (tr === 'zoom' && lt < 0.45) cam.z *= lerp(1.5, 1, ease.out(lt / 0.45));
  if (tr === 'whip' && lt < 0.3) cam.cx += (1 - ease.out(lt / 0.3)) * V.W * 0.35 / cam.z;

  g.fillStyle = css(P.skyTop);
  g.fillRect(0, 0, V.W, V.H);

  // ---- set ----
  const S = { ...V, t: tWorld, keyPos: null, boardText: shot.boardText, crowdCheer: shot.fx.some((f) => f.type === 'crowd' && f.cheer) };
  S.layer = (d, fn) => { g.save(); applyCam(g, cam, V, d); fn(); g.restore(); };
  setHide(shot.hide);
  SETS[shot.set].draw(g, S);
  setHide(null);
  const key = S.keyPos || { x: V.W * 0.7, y: V.H * 0.1 };

  // ---- world layer (depth 1) ----
  g.save();
  applyCam(g, cam, V, 1);
  for (const p of shot.props) if (p.layer === 'back') dp(p);
  if (shot.fx.some((f) => f.type === 'crowd')) {
    const cr = shot.fx.find((f) => f.type === 'crowd');
    const n = clamp(num(cr.count, 9), 3, 20);
    for (let k = 0; k < n; k++) {
      const x = ((k + 0.5) / n) * V.W * 1.2 - V.W * 0.1;
      const poses = cr.cheer ? ['cheer', 'victory', 'clap'] : ['stand', 'crossArms', 'hips', 'talk'];
      const pose = animatePose(POSES[poses[k % poses.length]], tWorld + k, k);
      drawFigure(g, { x, y: V.GY - 80 * V.figScale, scale: V.figScale * 0.6, f: k % 2 ? -1 : 1, pose, mood: cr.cheer ? 'joy' : 'neutral', t: tWorld + k * 0.7, seed: k, rim: false, wear: [] }, { ...look, figure: { ...look.figure, ink: mix(look.figure.ink, P.wall, 0.35), far: mix(look.figure.far, P.wall, 0.45), rim: null, sticker: null } }, { glow: false });
    }
  }
  for (const p of shot.props) if (p.layer !== 'back' && p.layer !== 'front' && p.ground) dp(p);
  // particles on the back layer fall behind the figures (and in front of the set and ground props)
  const clearZones = (f) => {
    const list = !f.clear ? [] : Array.isArray(f.clear) ? f.clear : [f.clear];
    return list.map((z) => {
      const s = z.on ? states[z.on] : null;
      const cx = s ? s.x + num(z.dx, 0) * V.W : null, hw = num(z.w, 0.1) * V.W * 0.5;
      const a = project(cam, V, s ? cx - hw : num(z.x0, 0) * V.W, num(z.y0, 0) * V.H);
      const b = project(cam, V, s ? cx + hw : num(z.x1, 1) * V.W, z.y1 != null ? num(z.y1, 1) * V.H : V.GY + 40);
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    });
  };
  const particles = (f) => drawParticles(g, f.type, tWorld + shot.start, V, shot.seed % 1000, num(f.density, 1), clearZones(f));
  for (const f of shot.fx) {
    if (f.layer !== 'back' || !PARTICLE_FX.has(f.type) || lt < f._at || (f._until != null && lt > f._until)) continue;
    g.save(); g.setTransform(width / V0.W, 0, 0, height / V0.H, 0, 0); particles(f); g.restore();
  }
  const anchors = {};
  // back row first; a carried body goes under the arms that hold it
  const rank = (a) => (states[a.id].back ? 0 : states[a.id].carried ? 1 : 2);
  const order = shot.actors.slice().sort((a, b) => rank(a) - rank(b));
  for (const A of order) {
    const s = states[A.id];
    const R = A.reveal;
    if (!(R && s.t < R.at) && !S.noFloor && !s.pose.rot && !s.carried && !s.riding && !A.lineWeight) drawShadow(g, s.x, s.y, s.scale, P);
    const headY = s.y - figureHeight(s.scale);
    const dx = key.x - s.x, dy = key.y - headY;
    const len = Math.hypot(dx, dy) || 1;
    const fa = {
      x: s.x, y: s.y, scale: s.scale, f: s.f, turn: s.turn, pose: s.pose, mood: s.mood, color: A.color, wear: A.wear, noFace: A.noFace,
      lineWeight: A.lineWeight, glow: A.glow, lineColor: A.lineColor,
      talk: s.talk, t: s.t, seed: A.seed, light: { dx: dx / len, dy: dy / len }, held: s.held, rim: A.rim, ...figFields(A, s),
    };
    const fx = { drawHeld: heldDrawer(A, P, s.t, s.holdMeta), glow: !s.back };
    if (R && s.t < (R.realAt ?? Infinity) + R.real) {
      const r = drawReveal(g, { ...R, order: A.lineWeight ? 'figure' : R.order }, s.t, (gg) => { anchors[A.id] = drawFigure(gg, fa, look, fx); });
      if (r?.tip) tips[A.id] = r.tip;
      if (R.hand && r?.tip) drawProp(g, 'hand', r.tip.x, r.tip.y, V.propScale, P, tWorld, { tool: R.tip === 'pencil' ? 'pencil' : 'chalk', tremble: R.tremble });
      if (!anchors[A.id]) anchors[A.id] = { head: { x: s.x, y: headY, r: 0 }, hand: { x: s.x, y: s.y }, top: headY };
    } else anchors[A.id] = drawFigure(g, fa, look, fx);
  }
  for (const p of shot.props) if (p.layer === 'front' || (!p.ground && p.layer !== 'back')) dp(p);
  g.restore();

  // ---- atmosphere ----
  for (const f of shot.fx) {
    if (f.layer === 'back' || !PARTICLE_FX.has(f.type) || lt < f._at || (f._until != null && lt > f._until)) continue;
    particles(f);
  }
  if (shot.freeze) {
    const k = frozen ? clamp((lt - shot.freeze.at) / 0.25) : 0;
    if (k > 0) {
      if (shot.freeze.tint) drawFreezeTint(g, V, k);
      if (shot.freeze.sparkles) { g.save(); g.globalAlpha = 0.9; drawParticles(g, 'sparkles', shot.freeze.at, V, 3, 0.5); g.restore(); }
      // the hero is redrawn unfrozen on top of the tint
      const hero = shot.actors.find((a) => a.id === shot.freeze.hero);
      if (hero) {
        const s = states[hero.id];
        g.save(); applyCam(g, cam, V, 1);
        drawFigure(g, { x: s.x, y: s.y, scale: s.scale, f: s.f, turn: s.turn, pose: s.pose, mood: s.mood, color: hero.color, wear: hero.wear, noFace: hero.noFace, lineWeight: hero.lineWeight, glow: hero.glow, lineColor: hero.lineColor, talk: s.talk, t: s.t, seed: hero.seed, light: { dx: 0, dy: -1 }, held: s.held, ...figFields(hero, s) }, look, { drawHeld: heldDrawer(hero, P, s.t, s.holdMeta) });
        g.restore();
      }
    }
  }
  for (const f of shot.fx) {
    const tail = EASED_SCREEN_FX.has(f.type) ? SCREEN_FX_EASE : 0;
    if (!SCREEN_FX.has(f.type) || lt < f._at || (f._until != null && lt > f._until + tail)) continue;
    let info = {};
    if (f.type === 'spotlight') {
      const a = anchors[f.on] || Object.values(anchors)[0];
      if (a) { const p = project(cam, V, a.head.x, a.head.y + 80); info = { x: p.x, y: p.y }; }
    }
    if (f.type === 'godrays') { const p = project(cam, V, key.x, key.y); info = { kx: p.x, ky: p.y }; }
    // lighting effects cued mid-shot ease in (and ease out after "until")
    if (f._at > 0) info.age = tWorld - f._at;
    if (f._until != null) info.left = f._until - tWorld;
    drawScreenFx(g, f.type, tWorld, V, info);
  }

  // ---- speech bubbles ----
  for (const A of shot.actors) {
    const a = anchors[A.id];
    if (!a) continue;
    for (const s of A.says) {
      if (lt < s.t || lt > s.until) continue;
      const p = project(cam, V, a.head.x, a.top);
      drawBubble(g, s.text, p.x, p.y, V, clamp((lt - s.t) / 0.25));
    }
  }

  // ---- letterbox ----
  if (shot.bars) {
    const bh = V.H * (V.vertical ? 0.06 : 0.1) * ease.out(clamp(lt / 0.4));
    g.fillStyle = '#000';
    g.fillRect(0, 0, V.W, bh);
    g.fillRect(0, V.H - bh, V.W, bh);
  }

  // ---- graphics ----
  for (const o of shot.overlays) {
    if (o.on && anchors[o.on]) { const a = anchors[o.on]; o._anchor = project(cam, V, a.head.x, a.top); } else o._anchor = null;
    drawOverlay(g, o, shot.freeze?.all ? tWorld : lt, V);
  }
  if (film.captions && shot.captions && opts.captions !== false && opts._shot == null) drawCaptions(g, film.captions, t, V);

  drawGrade(g, V, look, t, opts.env || {});

  // ---- transitions ----
  if (tr === 'fade' && lt < 0.4) { g.fillStyle = css('#000', 1 - ease.out(lt / 0.4)); g.fillRect(0, 0, V.W, V.H); }
  const dipD = shot.transitionDur ?? 0.6;
  if (tr === 'dip' && lt < dipD) { g.fillStyle = css('#000', 1 - ease.inOut(lt / dipD)); g.fillRect(0, 0, V.W, V.H); }
  // dissolve: the previous shot, still running, fades out over this one
  if (tr === 'dissolve') {
    const d = shot.transitionDur ?? 0.6;
    if (lt < d) {
      const prevPic = i > 0 ? outgoingPicture(film, t, i - 1, width, height, opts) : null;
      if (prevPic) {
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1 - ease.inOut(lt / d); g.drawImage(prevPic, 0, 0, width, height); g.restore();
      } else { g.fillStyle = css('#000', 1 - ease.inOut(lt / d)); g.fillRect(0, 0, V.W, V.H); }
    }
  }
  if (tr === 'flash' && lt < 0.35) { g.fillStyle = css('#ffffff', Math.pow(1 - lt / 0.35, 2)); g.fillRect(0, 0, V.W, V.H); }
  if (tr === 'whip' && lt < 0.3) drawScreenFx(g, 'speedlines', lt, V);
  if (tr === 'wipe' && lt < 0.45) { const k = ease.inOut(lt / 0.45); g.fillStyle = css(P.ui.gold); g.beginPath(); g.moveTo(V.W * k * 1.4, 0); g.lineTo(V.W * 1.4, 0); g.lineTo(V.W * 1.4, V.H); g.lineTo(V.W * k * 1.4 - V.W * 0.3, V.H); g.fill(); }
  // a dip into the next shot starts by easing this one down to black
  const next = film.shots[i + 1];
  if (opts._shot == null && next && next.transition === 'dip' && t < shot.end && shot.end - t < DIP_PREROLL) {
    g.fillStyle = css('#000', ease.inOut(clamp(1 - (shot.end - t) / DIP_PREROLL)));
    g.fillRect(0, 0, V.W, V.H);
  }
  // fade the very end of the film to black
  if (opts.endFade !== false && opts._shot == null && film.duration - t < 0.5) { g.fillStyle = css('#000', 1 - clamp((film.duration - t) / 0.5)); g.fillRect(0, 0, V.W, V.H); }
}

// An offscreen copy of an earlier shot at time t, for a dissolve. Null when no canvas can be made.
let dissolveCv = null;
function outgoingPicture(film, t, shotIndex, width, height, opts) {
  const make = opts.env?.createCanvas || (typeof document !== 'undefined' ? (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; } : null);
  if (!make) return null;
  if (!dissolveCv || dissolveCv.width !== width || dissolveCv.height !== height) dissolveCv = make(width, height);
  renderFrame(dissolveCv.getContext('2d'), film, t, { ...opts, width, height, _shot: shotIndex });
  return dissolveCv;
}

// Positions of everything in one frame, without drawing (tests, framing checks, tools).
// Returns { shot, cam, actors: {id: {x, y, f, scale}}, props: [{type, x, y, size, visible}] }
export function inspectFrame(film, t) {
  const i = shotIndexAt(film, t);
  if (i < 0) return null;
  const shot = film.shots[i];
  const lt = clamp(t - shot.start, 0, shot.end - shot.start + 1);
  const scene = makeScene(shot, lt, film);
  const cam = cameraAt(shot, lt, film, scene.states, scene);
  const actors = {};
  for (const [id, s] of Object.entries(scene.states)) {
    const J = figureJoints(s), W = (q) => ({ x: s.x + q.x * s.scale, y: s.y + q.y * s.scale });
    actors[id] = { x: s.x, y: s.y, f: s.f, scale: s.scale, gait: s.gaitInfo, joints: { hip: W(J.hip), neck: W(J.neck), head: W(J.head), ll: J.ll.map(W), rl: J.rl.map(W), la: J.la.map(W), ra: J.ra.map(W) } };
  }
  const props = shot.props.map((p) => { const pl = scene.place(p); return { type: p.type, x: pl.x, y: pl.y, size: pl.size * pl.pop, alpha: pl.alpha, visible: pl.visible && pl.alpha > 0, flip: pl.flip }; });
  return { shot: shot.id, lt, cam, actors, props, project: (x, y) => project(cam, film, x, y) };
}

// Props whose visual centre falls outside the frame (sampled in the middle of the time
// they are on screen). Returns a list of human-readable warnings.
// Uncued ground props (set dressing) are not checked.
export function framingWarnings(film, limit = 20) {
  const out = [];
  let more = 0;
  for (const shot of film.shots) {
    const dur = shot.end - shot.start;
    for (const p of shot.props) {
      if (p.frame === false || p.type === 'line' || p.type === 'glow') continue;
      if (p.ground && p._at < 0 && p.frame !== true) continue;
      const a0 = Math.max(0, p._at), a1 = p._until != null ? Math.min(dur, p._until) : dur;
      if (a1 <= a0) continue;
      const lt = (a0 + Math.min(a1, a0 + 1.5)) / 2 + 0.15;
      const scene = makeScene(shot, Math.min(lt, dur), film);
      const cam = cameraAt(shot, Math.min(lt, dur), film, scene.states, scene);
      const pl = scene.place(p);
      const cy = p.ground ? pl.y - 0.5 * propBox(p.type).h * pl.size : pl.y;
      const q = project(cam, film, pl.x, cy);
      if (q.x < 0 || q.x > film.W || q.y < 0 || q.y > film.H) {
        if (out.length < limit) out.push(`Shot ${shot.id}: prop "${p.type}" (x ${+p.x.toFixed(2)}${p.y != null ? `, y ${+(+p.y).toFixed(2)}` : ''}) is outside the ${shot.camera.shot} frame`);
        else more++;
      }
    }
  }
  if (more) out.push(`...and ${more} more props outside their frame`);
  return out;
}
