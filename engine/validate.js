// Cleans up a storyboard written by an AI (or by hand) so it always renders:
// unknown names are mapped to the closest valid one, timing is made contiguous,
// numbers are clamped. Returns { story, warnings }.
import { POSES, MOODS, WEAR } from './rig.js';
import { PROPS, SURFACE_PROPS } from './props.js';
import { SETS } from './sets.js';
import { FX } from './fx.js';
import { OVERLAY_TYPES } from './overlays.js';
import { LIGHTS, LOOKS } from './looks.js';
import { CAMERA_SHOTS, CAMERA_MOVES, TRANSITIONS, SFX, MUSIC_MOODS } from './catalog.js';
import { compileFilm, framingWarnings, CAPS } from './film.js';
import { GAITS } from './gait.js';

// Named surfaces an actor can stand ("on") or sit ("sit") on: props with a surface, plus the stage set.
const SURFACES = [...SURFACE_PROPS, 'stage'];
const EASINGS = ['linear', 'in', 'out', 'inOut'];
const idOf = (v) => String(v).trim().toLowerCase().replace(/\s+/g, '_');
const LOOK_NAMES = ['down', 'up', 'left', 'right', 'ahead'];
const HANDS = ['near', 'far', 'left', 'right'];

const ALIASES = {
  pose: { recoiling: 'recoil', eating: 'eat', standing: 'stand', idle: 'stand', sitting: 'sit', seated: 'sit', running: 'run', walking: 'walk', thinking: 'think', pointing: 'point', waving: 'wave', cheering: 'cheer', shrugging: 'shrug', jumping: 'jump', falling: 'fall', lying: 'lie', laying: 'lie', sleeping: 'sleep', kneeling: 'kneel', crouching: 'crouch', typing: 'type', holding: 'hold', carrying: 'carry', reaching: 'reach', pushing: 'push', dancing: 'dance', bowing: 'bow', talking: 'talk', clapping: 'clap', crying: 'cry', laughing: 'laugh', praying: 'pray', hugging: 'hug', writing: 'write', lifting: 'lift', swimming: 'swim', floating: 'float', armscrossed: 'crossArms', crossarms: 'crossArms', handsonhips: 'hips', celebrate: 'celebrate', excited: 'cheer', defeated: 'sad', slump: 'sad', worried: 'scared', afraid: 'scared', run: 'run', walk: 'walk', present: 'present', explain: 'talk', gesture: 'talk', lookup: 'lookUp', pointup: 'pointUp', pointdown: 'pointDown', sitfloor: 'sitFloor', facepalm: 'facepalm' },
  mood: { dreading: 'dread', neutral: 'neutral', calm: 'neutral', content: 'happy', smiling: 'happy', glad: 'happy', ecstatic: 'joy', laughing: 'joy', delighted: 'joy', thrilled: 'excited', unhappy: 'sad', upset: 'sad', crying: 'cry', mad: 'angry', rage: 'furious', amazed: 'surprised', astonished: 'shocked', terrified: 'scared', afraid: 'scared', fear: 'scared', anxious: 'nervous', stressed: 'worried', curious: 'thinking', pensive: 'thinking', puzzled: 'confused', smug: 'smirk', tired: 'sleepy', exhausted: 'sleepy', focused: 'determined', serious: 'determined', inlove: 'love', awe: 'surprised', proud: 'proud', bored: 'bored', shy: 'embarrassed', cool: 'cool', dead: 'dead' },
  set: { bedroom: 'bedroom', home: 'livingroom', house: 'livingroom', apartment: 'livingroom', living: 'livingroom', school: 'classroom', class: 'classroom', street: 'street', city: 'city', town: 'street', outside: 'park', garden: 'park', nature: 'park', woods: 'forest', ocean: 'beach', sea: 'beach', river: 'lake', pier: 'lake', jetty: 'lake', hills: 'mountain', mountains: 'mountain', stadium: 'field', arena: 'field', court: 'field', track: 'field', highway: 'road', car: 'road', galaxy: 'space', planet: 'space', clouds: 'sky', ocean_floor: 'underwater', sea_floor: 'underwater', diagram: 'blueprint', explainer: 'blueprint', abstract: 'void', black: 'void', theater: 'stage', theatre: 'stage', restaurant: 'cafe', coffee: 'cafe', coffeeshop: 'cafe', clinic: 'hospital', doctor: 'hospital', laboratory: 'lab', workplace: 'office', work: 'office', corridor: 'hallway', lockers: 'hallway', swimming: 'pool' },
  prop: { marker: 'pencil', crayon: 'pencil', sketchbook: 'notebook', notepad: 'notebook', journal: 'notebook', diary: 'notebook', sheet: 'paper', letter: 'paper', note: 'paper', drawing: 'paper', page: 'paper', puppy: 'dog', pigeon: 'bird', seagull: 'bird', goose: 'bird', toast: 'sandwich', sub: 'sandwich', wing: 'wings', icecream: 'cup', smartphone: 'phone', cellphone: 'phone', watch: 'stopwatch', timer: 'stopwatch' },
};

// Motion a viewer would read as a mistake: a stride held on the spot, or a long glide on still legs.
function motionWarnings(a, shot, raw, cast0, warn) {
  const moves = (a.do || []).filter((d) => d.walkTo != null || d.runTo != null || d.moveTo != null || d.exit);
  const stride = [a.pose, ...(a.do || []).map((d) => d.pose)].some((p) => p === 'walk' || p === 'run');
  if (stride && !moves.length && !a.march && !a.with) warn(`Shot ${shot.id}: actor "${a.id}" has pose "walk"/"run" but no walkTo, runTo or exit: it holds a frozen stride. Give it a move, or "march": true for an explicit walk on the spot`);
  let x = a.x ?? 0.5;
  for (const d of a.do || []) {
    const to = d.walkTo ?? d.runTo ?? d.moveTo;
    if (to == null) continue;
    const dist = Math.abs(to - x) * 1920;
    if (d.moveTo != null && dist > 200 && !stride && d.y == null) warn(`Shot ${shot.id}: actor "${a.id}" glides ${Math.round(dist)} px with moveTo on still legs; use walkTo or runTo unless it is meant to float`);
    if (d.dur != null && d.moveTo == null) {
      const kind = d.runTo != null ? 'run' : 'walk';
      const cad = dist / GAITS[kind].step / d.dur;
      if (cad > GAITS[kind].cadence * 2) warn(`Shot ${shot.id}: actor "${a.id}" ${kind}s ${Math.round(dist)} px in ${d.dur} s, about ${cad.toFixed(1)} steps a second: too fast to read as a ${kind}`);
    }
    x = to;
  }
}

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }

function pick(value, valid, aliases, fallback, warn, what) {
  if (value == null || value === '') return fallback;
  if (valid[value] !== undefined || (Array.isArray(valid) && valid.includes(value))) return value;
  const keys = Array.isArray(valid) ? valid : Object.keys(valid);
  const n = norm(value);
  const direct = keys.find((k) => norm(k) === n);
  if (direct) return direct;
  if (aliases && aliases[n]) return aliases[n];
  const partial = keys.find((k) => n.includes(norm(k)) || norm(k).includes(n));
  if (partial && n.length >= 3) return partial;
  if (warn) warn(`Unknown ${what} "${value}" replaced with "${fallback}"`);
  return fallback;
}

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : d);
const clampN = (v, lo, hi, d) => Math.min(hi, Math.max(lo, num(v, d)));

// "with": follow an actor (id) or a prop (prop type) every frame.
function cleanWith(w, warn) {
  if (w == null || w === false) return null;
  const o = typeof w === 'string' ? { id: w } : typeof w === 'object' ? w : null;
  if (!o || (!o.id && !o.prop)) { warn('Ignored "with" without an id or prop'); return null; }
  const q = {};
  if (o.id) q.id = PROPS[o.id] ? String(o.id) : idOf(o.id);
  if (o.prop && !o.id) q.prop = pick(o.prop, PROPS, ALIASES.prop, null, warn, 'prop to follow') || undefined;
  if (!q.id && !q.prop) return null;
  if (o.dx != null) q.dx = clampN(o.dx, -1, 1, 0);
  if (o.dy != null) q.dy = clampN(o.dy, -1, 1, 0);
  if (o.walk) q.walk = true;
  if (o.turn === false) q.turn = false;
  if (o.carry) q.carry = true;
  return q;
}
const surfaceName = (v, warn) => (v == null || v === '' ? undefined : pick(v, SURFACES, ALIASES.prop, undefined, warn, 'surface'));

// A gaze: one of the names, or {x, y} each -1..1 (y: +1 down).
function cleanLook(v, warn) {
  if (typeof v === 'string') {
    if (LOOK_NAMES.includes(v)) return v;
    warn(`Unknown look "${v}" ignored; use ${LOOK_NAMES.join(', ')} or {x, y}`);
    return undefined;
  }
  if (v && typeof v === 'object') return { x: clampN(v.x, -1, 1, 0), y: clampN(v.y, -1, 1, 0) };
  return undefined;
}
// A grip: {x, y} (both hands), plus hand, dur, ease, arm, show, release; or {left|right|near|far: {x, y, ...}}.
function cleanGrip(g, warn) {
  if (!g || typeof g !== 'object') return null;
  const one = (o) => {
    if (!o || typeof o !== 'object') return null;
    const q = {};
    if (o.x != null) q.x = num(o.x, 0.5);
    if (o.y != null) q.y = num(o.y, 0.5);
    if (o.release) q.release = true;
    if (o.dur != null) q.dur = Math.max(0, num(o.dur, 0));
    if (o.ease != null) { const e = pick(o.ease, EASINGS, null, undefined, warn, 'easing'); if (e) q.ease = e; }
    if (o.arm != null) q.arm = o.arm === false ? 'none' : String(o.arm);
    if (o.show != null) q.show = String(o.show);
    return q;
  };
  const parts = HANDS.filter((k) => g[k] !== undefined);
  if (parts.length) {
    const q = one(g);
    for (const k of parts) q[k] = one(g[k]);
    return q;
  }
  const q = one(g);
  // a plain {x, y} with nothing else keeps both coordinates, as it always has
  if (!q.release) { q.x = num(g.x, 0.5); q.y = num(g.y, 0.5); }
  if (g.hand) q.hand = pick(g.hand, [...HANDS, 'both'], null, 'both', warn, 'hand');
  return q;
}
// Fields shared by an actor and a "do" event: what is held and how.
function holdFields(src, dst, warn) {
  if (src.holdOpts && typeof src.holdOpts === 'object') dst.holdOpts = src.holdOpts;
  else if ('holdOpts' in src && !src.holdOpts) dst.holdOpts = null;
  if (src.holdHand) dst.holdHand = pick(src.holdHand, HANDS, null, undefined, warn, 'hand');
  if (src.holdStyle) dst.holdStyle = src.holdStyle === 'low' ? 'low' : 'reach';
}

// meta.sfxIds: sound IDs from the active sound library; those are kept as written.
export function validateStoryboard(raw, meta = {}) {
  const warnings = [];
  const libIds = Array.isArray(meta.sfxIds) ? meta.sfxIds.map(String) : [];
  const libSound = (v) => (v == null ? null : libIds.includes(String(v)) ? String(v) : libIds.find((k) => k.toLowerCase() === String(v).trim().toLowerCase()) || null);
  const warn = (m) => { if (warnings.length < 60) warnings.push(m); };
  // a list over its cap loses items, so this is always reported, however many warnings came first
  const capped = (list, cap, what) => {
    const a = Array.isArray(list) ? list : [];
    if (a.length > cap) warnings.push(`${what}: ${a.length} items, only the first ${cap} are used; ${a.length - cap} dropped`);
    return a.slice(0, cap);
  };
  const story = typeof raw === 'object' && raw ? raw : {};
  const duration = num(meta.duration, 0);
  const out = { title: String(story.title || meta.title || 'Untitled'), look: LOOKS[story.look] ? story.look : undefined, cast: [], shots: [], music: [] };

  const castIds = new Set();
  const cast0 = out.cast;
  for (const c of Array.isArray(story.cast) ? story.cast : []) {
    if (!c || !c.id) continue;
    const id = String(c.id).trim().toLowerCase().replace(/\s+/g, '_');
    if (castIds.has(id)) continue;
    castIds.add(id);
    const wear = (Array.isArray(c.wear) ? c.wear : c.wear ? [c.wear] : []).map((w) => pick(w, WEAR, null, null, warn, 'wardrobe item')).filter(Boolean).slice(0, 4);
    const row = { id, name: String(c.name || c.id), role: c.role ? String(c.role) : undefined, color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : undefined, wear, kid: !!c.kid };
    if (c.scale != null) row.scale = clampN(c.scale, 0.3, 2.5, 1);
    if (c.noFace) row.noFace = true;
    if (c.lineWeight != null) row.lineWeight = clampN(c.lineWeight, 0.5, 30, 5);
    if (c.glow) row.glow = c.glow === true ? 1 : clampN(c.glow, 0, 3, 1);
    if (c.lineColor) row.lineColor = String(c.lineColor);
    if (c.weight != null) row.weight = clampN(c.weight, 0, 3, 1);
    if (c.hairColor) row.hairColor = String(c.hairColor);
    if (c.scarf) row.scarf = String(c.scarf);
    out.cast.push(row);
  }

  let shots = (Array.isArray(story.shots) ? story.shots : []).filter((s) => s && typeof s === 'object');
  shots.forEach((s, i) => { s._order = i; s.start = num(s.start, NaN); s.end = num(s.end, NaN); });
  shots = shots.filter((s) => isFinite(s.start)).sort((a, b) => a.start - b.start || a._order - b._order);
  // contiguous timing (meta.partial: a fragment of a film keeps its own absolute start)
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i], next = shots[i + 1];
    if (i === 0 && s.start > 0 && !meta.partial) s.start = 0;
    if (next) s.end = next.start;
    else s.end = Math.max(isFinite(s.end) ? s.end : s.start + 3, duration || 0);
    if (s.end - s.start < 0.15) s._drop = true;
  }
  shots = shots.filter((s) => !s._drop);
  for (let i = 1; i < shots.length; i++) shots[i].start = shots[i - 1].end;
  if (!shots.length && duration) shots = [{ start: 0, end: duration, set: 'void', actors: [] }];

  const ids = new Set();
  shots.forEach((s, i) => {
    let id = String(s.id || `s${i + 1}`);
    while (ids.has(id)) id += '_';
    ids.add(id);
    const shot = {
      id,
      start: +s.start.toFixed(3),
      end: +s.end.toFixed(3),
      line: s.line ? String(s.line) : undefined,
      scene: s.scene ? String(s.scene) : undefined,
      set: pick(s.set, SETS, ALIASES.set, 'void', warn, 'set'),
      light: s.light ? pick(s.light, LIGHTS, null, undefined, warn, 'light') : undefined,
      camera: {
        shot: pick(s.camera?.shot, CAMERA_SHOTS, null, 'wide', warn, 'camera shot'),
        on: s.camera?.on ?? undefined,
        move: pick(s.camera?.move, CAMERA_MOVES, null, 'push', warn, 'camera move'),
        amount: s.camera?.amount != null ? Math.min(0.5, Math.max(0, num(s.camera.amount, 0.1))) : undefined,
        shake: s.camera?.shake != null ? Math.min(1, Math.max(0, num(s.camera.shake, 0))) : undefined,
        roll: s.camera?.roll != null ? Math.min(15, Math.max(-15, num(s.camera.roll, 0))) : undefined,
        fit: s.camera?.fit === false ? false : undefined,
        x: s.camera?.x != null ? clampN(s.camera.x, -1, 2, 0.5) : undefined,
        y: s.camera?.y != null ? clampN(s.camera.y, -1, 2, 0.5) : undefined,
        zoom: s.camera?.zoom != null ? clampN(s.camera.zoom, 1, 20, 1) : undefined,
        dx: s.camera?.dx != null ? clampN(s.camera.dx, -1, 1, 0) : undefined,
        dy: s.camera?.dy != null ? clampN(s.camera.dy, -1, 1, 0) : undefined,
        to: s.camera?.to && typeof s.camera.to === 'object' ? {
          x: s.camera.to.x != null ? clampN(s.camera.to.x, -1, 2, 0.5) : undefined,
          y: s.camera.to.y != null ? clampN(s.camera.to.y, -1, 2, 0.5) : undefined,
          zoom: s.camera.to.zoom != null ? clampN(s.camera.to.zoom, 1, 20, 1) : undefined,
          at: s.camera.to.at != null ? Math.max(0, num(s.camera.to.at, 0)) : undefined,
          word: s.camera.to.word ? String(s.camera.to.word) : undefined,
          dur: s.camera.to.dur != null ? Math.max(0.01, num(s.camera.to.dur, 1)) : undefined,
          ease: s.camera.to.ease != null ? pick(s.camera.to.ease, EASINGS, null, undefined, warn, 'easing') : undefined,
        } : undefined,
      },
      transition: pick(s.transition || s.in, TRANSITIONS, null, 'cut', warn, 'transition'),
      transitionDur: s.transitionDur != null ? clampN(s.transitionDur, 0.05, 4, 0.6) : undefined,
      hide: Array.isArray(s.hide) && s.hide.length ? s.hide.map(String) : undefined,
      bars: s.bars ? true : undefined,
      captions: s.captions === false ? false : undefined,
      boardText: s.boardText ? String(s.boardText).slice(0, 40) : undefined,
      actors: [],
      props: [],
      text: [],
      fx: [],
      sfx: [],
    };
    // an explicit camera holds still unless a move was asked for
    if ((shot.camera.x != null || shot.camera.y != null || shot.camera.to) && !s.camera?.move) shot.camera.move = 'lock';
    for (const a of capped(s.actors, CAPS.actors, `Shot ${id}: actors`)) {
      if (!a || !a.id) continue;
      const aid = String(a.id).trim().toLowerCase().replace(/\s+/g, '_');
      if (!castIds.has(aid) && !aid.startsWith('extra')) {
        castIds.add(aid);
        out.cast.push({ id: aid, name: String(a.id), wear: [] });
        warn(`Actor "${aid}" was not in the cast; added`);
      }
      const act = {
        id: aid,
        x: Math.min(1.3, Math.max(-0.3, num(a.x, undefined) ?? 0.5)),
        face: a.face ? pick(a.face, ['left', 'right', 'front'], null, undefined, warn, 'facing') : undefined,
        pose: pick(a.pose, POSES, ALIASES.pose, 'stand', warn, 'pose'),
        mood: pick(a.mood, MOODS, ALIASES.mood, 'neutral', warn, 'mood'),
        hold: a.hold ? pick(a.hold, PROPS, ALIASES.prop, undefined, warn, 'held prop') : undefined,
        talk: a.talk ? true : undefined,
        depth: a.depth === 'back' ? 'back' : undefined,
        scale: a.scale != null ? Math.min(2.5, Math.max(0.3, num(a.scale, 1))) : undefined,
        y: a.y != null ? (typeof a.y === 'string' && !isFinite(+a.y) ? undefined : Math.min(1, Math.max(0, num(a.y, 0.8)))) : undefined,
        on: surfaceName(a.on ?? (typeof a.y === 'string' && !isFinite(+a.y) ? a.y : undefined), warn),
        sit: surfaceName(a.sit, warn),
        lift: a.lift != null ? clampN(a.lift, -400, 800, 0) : undefined,
        with: a.with ? cleanWith(a.with, warn) || undefined : undefined,
        do: [],
      };
      for (const k of ['on', 'sit', 'lift', 'with']) if (act[k] === undefined) delete act[k];
      if (a.march) act.march = true;
      if (a.noFace) act.noFace = true;
      if (a.lineWeight != null) act.lineWeight = clampN(a.lineWeight, 0.5, 30, 5);
      if (a.glow) act.glow = a.glow === true ? 1 : clampN(a.glow, 0, 3, 1);
      if (a.lineColor) act.lineColor = String(a.lineColor);
      if (a.weight != null) act.weight = clampN(a.weight, 0, 3, 1);
      if (a.kid) act.kid = true;
      if (a.holdSize != null) act.holdSize = clampN(a.holdSize, 0.1, 4, 0.42);
      if (a.ride) act.ride = pick(a.ride, PROPS, ALIASES.prop, undefined, warn, 'ride');
      if (a.reveal) act.reveal = a.reveal;
      if (a.carry) act.carry = String(a.carry);
      if (a.grip && typeof a.grip === 'object') act.grip = cleanGrip(a.grip, warn);
      if (a.look != null) { const v = cleanLook(a.look, warn); if (v !== undefined) act.look = v; }
      holdFields(a, act, warn);
      if (a.color && /^#[0-9a-f]{6}$/i.test(a.color)) act.color = a.color;
      if (Array.isArray(a.wear) && a.wear.length) act.wear = a.wear.map((w) => pick(w, WEAR, null, null, warn, 'wardrobe item')).filter(Boolean).slice(0, 4);
      if (a.hairColor) act.hairColor = String(a.hairColor);
      if (a.scarf) act.scarf = String(a.scarf);
      if (a.x == null) delete act.x;
      for (const d of capped(a.do, CAPS.do, `Shot ${id}: actor "${aid}" do events`)) {
        if (!d || typeof d !== 'object') continue;
        const e = {};
        if (d.look != null) { const v = cleanLook(d.look, warn); if (v !== undefined) e.look = v; }
        if (d.lookDur != null) e.lookDur = Math.max(0, num(d.lookDur, 0.3));
        if (d.poseDur != null) e.poseDur = Math.max(0.01, num(d.poseDur, 0.28));
        if (d.poseEase != null) { const pe = pick(d.poseEase, EASINGS, null, undefined, warn, 'easing'); if (pe) e.poseEase = pe; }
        if (d.legsFold) e.legsFold = d.legsFold === true ? 'kneelDown' : pick(d.legsFold, POSES, ALIASES.pose, 'kneelDown', warn, 'pose');
        if (d.back || d.keepFace) e.back = true;
        if (d.liftDur != null) e.liftDur = clampN(d.liftDur, 0.05, 8, 0.8);
        if (d.holdSize != null) e.holdSize = clampN(d.holdSize, 0.1, 4, 0.42);
        holdFields(d, e, warn);
        if (d.at != null) e.at = Math.max(0, num(d.at, 0));
        if (d.word) e.word = String(d.word);
        if (d.pose) e.pose = pick(d.pose, POSES, ALIASES.pose, 'stand', warn, 'pose');
        if (d.mood) e.mood = pick(d.mood, MOODS, ALIASES.mood, 'neutral', warn, 'mood');
        if (d.face) e.face = pick(d.face, ['left', 'right', 'front'], null, undefined, warn, 'facing');
        if ('hold' in d) e.hold = d.hold ? pick(d.hold, PROPS, ALIASES.prop, null, warn, 'held prop') : null;
        if ('talk' in d) e.talk = !!d.talk;
        if (d.say) e.say = String(d.say).slice(0, 80);
        if (d.until != null) e.until = num(d.until, undefined);
        for (const k of ['walkTo', 'runTo', 'moveTo']) if (d[k] != null) e[k] = Math.min(1.3, Math.max(-0.3, num(d[k], 0.5)));
        if (d.exit === 'left' || d.exit === 'right') e.exit = d.exit;
        if (d.jump) e.jump = true;
        if (d.dur != null) {
          e.dur = Math.max(0.1, num(d.dur, 1));
          if (num(d.dur, 1) < 0.1) warn(`Shot ${id}: actor "${aid}" has a do event with dur ${d.dur}, raised to the 0.1 s minimum`);
        }
        if ('y' in d) e.y = d.y === null || d.y === 'ground' || d.y === 'floor' ? 'ground' : Math.min(1, Math.max(0, num(d.y, 0.8)));
        if (d.ease != null) e.ease = pick(d.ease, EASINGS, null, undefined, warn, 'easing');
        if ('with' in d) e.with = cleanWith(d.with, warn);
        if (d.run) e.run = true;
        if ('carry' in d) e.carry = d.carry ? String(d.carry) : null;
        if ('grip' in d) e.grip = d.grip && typeof d.grip === 'object' ? cleanGrip(d.grip, warn) : null;
        if (e.ease === undefined) delete e.ease;
        if (Object.keys(e).length) act.do.push(e);
      }
      if (!act.do.length) delete act.do;
      motionWarnings(act, shot, s, cast0, warn);
      shot.actors.push(act);
    }
    for (const p of capped(s.props, CAPS.props, `Shot ${id}: props`)) {
      if (!p || !p.type) continue;
      const type = pick(p.type, PROPS, ALIASES.prop, null, warn, 'prop');
      if (!type) continue;
      const q = { type, x: Math.min(1.3, Math.max(-0.3, num(p.x, 0.5))) };
      for (const k of ['y', 'size', 'at', 'until', 'dur']) if (p[k] != null) q[k] = num(p[k], undefined);
      for (const k of ['word', 'untilWord', 'anim', 'text', 'color', 'layer']) if (p[k] != null) q[k] = String(p[k]);
      if (p.flip) q.flip = true;
      if (p.float) q.float = true;
      if (p.pop === false) q.pop = false;
      if (typeof p.frame === 'boolean') q.frame = p.frame;
      if (p.ease != null) { const e = pick(p.ease, EASINGS, null, undefined, warn, 'easing'); if (e) q.ease = e; }
      if (p.with) { const w = cleanWith(p.with, warn); if (w) q.with = w; }
      if (p.to && typeof p.to === 'object') q.to = { x: num(p.to.x, undefined), y: num(p.to.y, undefined) };
      if (q.size != null) q.size = Math.min(8, Math.max(0.1, q.size));
      // drawing options (legs, sag, open, gap, reveal, tween...) go through untouched
      for (const k of Object.keys(p)) if (!(k in q) && !k.startsWith('_') && k !== 'type') q[k] = p[k];
      if (q.type === 'dog' && q.legs != null && q.legs !== 3 && q.legs !== 4) { warn(`Dog legs must be 3 or 4 (got ${q.legs})`); q.legs = 4; }
      shot.props.push(q);
    }
    for (const o of capped(Array.isArray(s.text) ? s.text : s.overlays, CAPS.text, `Shot ${id}: text`)) {
      if (!o || !o.type) continue;
      const type = pick(o.type, OVERLAY_TYPES, null, null, warn, 'graphic');
      if (!type) continue;
      const q = { ...o, type };
      if (q.at != null) q.at = Math.max(0, num(q.at, 0));
      if (q.from != null) q.from = num(q.from, 0);
      if (q.to != null) q.to = num(q.to, 0);
      if (q.value != null) q.value = num(q.value, 0);
      if (q.icon && !q.prop) q.prop = q.icon;
      if (q.prop) q.prop = pick(q.prop, PROPS, ALIASES.prop, 'star', warn, 'icon prop');
      if (q.on) q.on = String(q.on).toLowerCase().replace(/\s+/g, '_');
      shot.text.push(q);
    }
    for (const f of capped(s.fx, CAPS.fx, `Shot ${id}: fx`)) {
      const o = typeof f === 'string' ? { type: f } : f;
      if (!o || !o.type) continue;
      const type = pick(o.type, FX, null, null, warn, 'effect');
      if (!type) continue;
      const q = { ...o, type };
      if (q.hero) q.hero = String(q.hero).toLowerCase().replace(/\s+/g, '_');
      if (q.on) q.on = String(q.on).toLowerCase().replace(/\s+/g, '_');
      shot.fx.push(q);
    }
    for (const x of (Array.isArray(s.sfx) ? s.sfx : []).slice(0, 8)) {
      const o = typeof x === 'string' ? { sound: x } : x;
      if (!o) continue;
      const sound = libSound(o.sound || o.name) || pick(o.sound || o.name, SFX, null, null, warn, 'sound effect');
      if (!sound) continue;
      const q = { sound };
      if (o.at != null) q.at = Math.max(0, num(o.at, 0));
      if (o.word) q.word = String(o.word);
      if (o.vol != null) q.vol = Math.min(2, Math.max(0, num(o.vol, 1)));
      if (o.gain != null) q.gain = Math.min(24, Math.max(-60, num(o.gain, 0)));
      if (o.pan != null) q.pan = Math.min(1, Math.max(-1, num(o.pan, 0)));
      if (typeof o.duck === 'boolean') q.duck = o.duck;
      shot.sfx.push(q);
    }
    for (const k of ['props', 'text', 'fx', 'sfx', 'actors']) if (!shot[k].length) delete shot[k];
    for (const k of Object.keys(shot)) if (shot[k] === undefined) delete shot[k];
    for (const k of Object.keys(shot.camera)) if (shot.camera[k] === undefined) delete shot.camera[k];
    if (shot.camera.to) for (const k of Object.keys(shot.camera.to)) if (shot.camera.to[k] === undefined) delete shot.camera.to[k];
    out.shots.push(shot);
  });

  for (const m of Array.isArray(story.music) ? story.music : []) {
    if (!m) continue;
    out.music.push({ start: Math.max(0, num(m.start, 0)), end: num(m.end, duration), mood: pick(m.mood, MUSIC_MOODS, null, 'calm', warn, 'music mood'), intensity: Math.min(1, Math.max(0, num(m.intensity, 0.6))), ...(Number.isFinite(Number(m.gain)) && m.gain != null ? { gain: Number(m.gain) } : {}) });
  }
  if (!out.music.length) delete out.music;
  if (!out.look) delete out.look;
  // Props that end up outside their shot's frame (after camera framing).
  if (meta.framing !== false) {
    try {
      const film = compileFilm(out, { duration, words: Array.isArray(meta.words) ? meta.words : [], aspect: meta.aspect });
      for (const m of framingWarnings(film, 20)) warn(m);
    } catch { /* framing check is advisory */ }
  }
  return { story: out, warnings };
}
