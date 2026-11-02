// Copy & paste mode on long videos: free chatbots cut a long storyboard short, so the video is
// directed one part at a time. Each part is about a minute, cut where a sentence ends. Cast, music
// and locations carry into later prompts, and the checked replies merge into one storyboard.
import crypto from 'node:crypto';

export const SINGLE_PROMPT_SECONDS = 75; // up to here, one prompt is enough
const PART_SECONDS = 65; // no part is planned longer than this, which averages about a minute
const SEARCH_SECONDS = 15; // how far from the even split to look for a sentence end
const MIN_COVERAGE = 0.85; // a reply covering less of its part than this is flagged short
const MAX_AVG_SHOT = 12; // seconds per shot; slower than this is flagged short
const MIN_SHOT = 0.15;

const round2 = (t) => Math.floor(t * 100) / 100;
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const castId = (v) => String(v).trim().toLowerCase().replace(/\s+/g, '_');
// A full stop after "Mr" or an initial does not end a sentence.
const NOT_AN_END = /^["'“‘(]*(mr|mrs|ms|dr|prof|sr|jr|st|mt|vs|etc|e\.g|i\.e|u\.s|u\.k|a\.m|p\.m|[a-z])\.$/i;
const endsSentence = (w) => {
  const text = String(w.text || '').trim();
  return /[.!?…]["'”’)\]]*$/.test(text) && !NOT_AN_END.test(text);
};

export const needsParts = (duration) => duration > SINGLE_PROMPT_SECONDS;

// Changes when the narration changes, so progress on an old transcript is not reused.
export function partsKey(words, duration) {
  const text = (words || []).map((w) => `${w.text}@${Number(w.start).toFixed(2)}`).join(' ');
  return crypto.createHash('sha1').update(`${duration.toFixed(2)}|${text}`).digest('hex').slice(0, 16);
}

// Times to cut at. The cut lands just before the next word, as the director's own shot cuts do.
export function splitParts(words, duration) {
  const count = Math.max(2, Math.ceil(duration / PART_SECONDS));
  const list = words || [];
  const cuts = [];
  for (let k = 1; k < count; k++) {
    const target = (k * duration) / count;
    const floor = cuts.length ? cuts[cuts.length - 1] + MIN_SHOT : 0;
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < list.length - 1; i++) {
      const at = list[i + 1].start;
      if (at <= floor || Math.abs(at - target) > SEARCH_SECONDS) continue;
      // nearest sentence end wins; failing that, the longest pause; failing that, the nearest word
      const pause = at - list[i].end;
      const score = endsSentence(list[i]) ? Math.abs(at - target) : 1000 + (pause > 0.25 ? -pause : 100 + Math.abs(at - target));
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) {
      const next = list[best + 1].start;
      cuts.push(round2(Math.min(next, Math.max(list[best].end, next - 0.1))));
    } else cuts.push(round2(target)); // nothing is said here
  }
  const edges = [0, ...cuts, +duration.toFixed(2)];
  return cuts.concat(null).map((_, i) => ({ n: i + 1, start: edges[i], end: edges[i + 1], status: 'todo' }));
}

export function newPlan(words, duration) {
  return { key: partsKey(words, duration), parts: splitParts(words, duration) };
}

const isDone = (part) => part.status === 'ok';
export const firstUnfinished = (plan) => plan.parts.find((x) => !isDone(x)) || null;
export const allDone = (plan) => plan.parts.every(isDone);

// What the UI and the CLI show. Leaves out the shots.
export function partsSummary(plan) {
  return plan.parts.map((x) => ({ n: x.n, start: x.start, end: x.end, status: x.status, issue: x.issue || undefined, shots: x.shots?.length || 0, covered: x.covered }));
}

// Everything a later part needs in order to match the earlier ones.
export function carryFrom(plan, n) {
  const earlier = plan.parts.filter((x) => x.n < n && x.shots?.length);
  // every part so far, including a retried one: later parts already use its characters
  const cast = mergedCast(plan.parts.filter((x) => x.shots?.length));
  const seen = new Map();
  for (const part of earlier) for (const s of part.shots) {
    const where = `${s.set || 'void'}${s.light ? ` (${s.light})` : ''}`;
    if (!seen.has(where)) seen.set(where, s.scene || '');
  }
  const prev = earlier[earlier.length - 1];
  const last = prev?.shots[prev.shots.length - 1];
  const music = prev?.music?.[prev.music.length - 1];
  return {
    cast,
    locations: [...seen].slice(-12).map(([where, scene]) => (scene ? `${where}: ${scene}` : where)),
    lastShot: last ? { line: last.line, scene: last.scene, set: last.set, light: last.light, actors: (last.actors || []).map((a) => a.id).filter(Boolean) } : null,
    lastMusic: music ? { mood: music.mood, intensity: music.intensity } : null,
  };
}

// Checks one reply against its part and returns the fields to save on it. Never throws:
// a broken reply comes back flagged, so the user can retry just that part.
export function checkPartReply(reply, part) {
  const raw = reply && typeof reply === 'object' ? reply : {};
  const length = part.end - part.start;
  const list = (Array.isArray(raw.shots) ? raw.shots : []).filter((s) => s && typeof s === 'object' && isFinite(num(s.start)));
  if (!list.length) return { status: 'broken', issue: 'The reply had no shots in it.', shots: [], covered: 0 };

  let shots = list.map((s, i) => ({ ...s, start: num(s.start), end: isFinite(num(s.end)) ? num(s.end) : NaN, _i: i }));
  shots.sort((a, b) => a.start - b.start || a._i - b._i);
  // a chatbot often restarts the clock at 0 for each part
  const lastEnd = Math.max(...shots.map((s) => (isFinite(s.end) ? s.end : s.start)));
  let shift = 0;
  if (part.start > 5 && shots[0].start < 1 && lastEnd <= length * 1.15) shift = part.start;
  shots.forEach((s, i) => {
    s.start = +(s.start + shift).toFixed(3);
    const next = shots[i + 1];
    s.end = isFinite(s.end) ? +(s.end + shift).toFixed(3) : (next ? next.start + shift : s.start + 3);
  });

  const inside = shots.filter((s) => s.end > part.start + MIN_SHOT && s.start < part.end - MIN_SHOT);
  if (!inside.length) return { status: 'broken', issue: `None of its shots fall between ${part.start.toFixed(1)} and ${part.end.toFixed(1)} s.`, shots: [], covered: 0 };

  // how much of the part the reply really covered, before any gaps are closed
  let covered = 0, reach = part.start;
  for (const s of inside) {
    const a = Math.max(s.start, reach), b = Math.min(s.end, part.end);
    if (b > a) { covered += b - a; reach = b; }
  }
  const share = covered / length;

  // no gaps or overlaps: each shot runs to the next one, and the first and last meet the part's edges
  const fixed = inside.map(({ _i, ...s }) => s);
  fixed[0].start = part.start;
  fixed.forEach((s, i) => { s.end = i + 1 < fixed.length ? fixed[i + 1].start : part.end; });
  const shotsOut = fixed.filter((s) => s.end - s.start >= MIN_SHOT);

  const out = {
    status: 'ok',
    issue: null,
    shots: shotsOut,
    covered: +covered.toFixed(2),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined,
    cast: Array.isArray(raw.cast) ? raw.cast.filter((c) => c && c.id) : [],
    music: cleanMusic(raw.music, part, shift),
  };
  if (share < MIN_COVERAGE) {
    out.status = 'short';
    out.issue = `It covers only ${covered.toFixed(0)} of this part's ${length.toFixed(0)} seconds.`;
  } else if (length / shotsOut.length > MAX_AVG_SHOT) {
    out.status = 'short';
    out.issue = `It has only ${shotsOut.length} shot${shotsOut.length === 1 ? '' : 's'} for ${length.toFixed(0)} seconds.`;
  }
  return out;
}

function cleanMusic(music, part, shift) {
  const rows = (Array.isArray(music) ? music : []).filter((m) => m && m.mood)
    .map((m) => ({ ...m, start: (isFinite(num(m.start)) ? num(m.start) : part.start) + shift, end: (isFinite(num(m.end)) ? num(m.end) : part.end) + shift }))
    .filter((m) => m.end > part.start && m.start < part.end)
    .sort((a, b) => a.start - b.start);
  return rows.map((m) => ({ ...m, start: Math.max(part.start, m.start), end: Math.min(part.end, m.end) }));
}

function mergedCast(parts) {
  const byId = new Map();
  for (const part of parts) for (const c of part.cast || []) {
    const id = castId(c.id);
    if (!byId.has(id)) byId.set(id, { ...c, id });
  }
  return [...byId.values()];
}

// One storyboard from all the parts, ready for validateStoryboard. Shot ids are renumbered, because
// every chatbot reply starts again at s1. A part with no music of its own continues the one before it.
export function mergeParts(plan, duration) {
  const shots = plan.parts.flatMap((part) => structuredClone(part.shots || []));
  shots.forEach((s, i) => { s.id = `s${i + 1}`; });

  const music = [];
  for (const part of plan.parts) {
    const rows = part.music?.length ? part.music : music.length ? [{ ...music[music.length - 1], start: part.start, end: part.end }] : [];
    for (const row of rows) {
      const prev = music[music.length - 1];
      if (prev && prev.mood === row.mood && Math.abs((prev.intensity ?? 0.6) - (row.intensity ?? 0.6)) < 0.15) prev.end = row.end;
      else music.push({ ...row });
    }
  }
  music.forEach((m, i) => { m.start = i ? music[i - 1].end : 0; if (i === music.length - 1) m.end = duration; });

  return { title: plan.parts.find((x) => x.title)?.title, cast: mergedCast(plan.parts), music, shots };
}
