// Self-test: checks the environment, validates the example storyboard, renders
// frames in every look, synthesises every sound effect and does a short render.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileFilm, renderFrame, validateStoryboard, inspectFrame, LOOK_IDS, SFX_IDS } from '../engine/index.js';
import { screenFxFade } from '../engine/fx.js';
import { drawProp, layoutText } from '../engine/props.js';
import { palette } from '../engine/looks.js';
import { setupFonts, createCanvas, env } from '../server/canvas.js';
import { findFfmpeg, run, decodePcm } from '../server/media.js';
import { sfxBuffer, SFX_NAMES, mixAudio, loadSfxLibrary, RATE, addDuckedMusic, DUCK_DEPTH_DB, BAND_DUCK_DB } from '../server/audio.js';
import { directorSystem, partPrompt } from '../server/prompts.js';
import { needsParts, splitParts, newPlan, checkPartReply, mergeParts, carryFrom, partsKey } from '../server/parts.js';
import { renderVideo } from '../server/render.js';
import { estimateWords } from '../server/voice.js';

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };

// Scene-field features: each builds a tiny storyboard, through the validator, and checks the result.
function featureChecks() {
  const cast = [{ id: 'a', name: 'a', wear: ['cap'] }, { id: 'b', name: 'b', kid: true }];
  const film = (shots, dur = 4) => {
    const { story, warnings } = validateStoryboard({ cast, shots }, { duration: dur, partial: true, framing: false });
    return { f: compileFilm(story, { aspect: '16:9', look: 'chalk', duration: dur }), warnings, story };
  };
  const shot = (o) => ({ id: 's', start: 0, end: 4, set: 'void', camera: { shot: 'wide', move: 'static' }, ...o });
  const pixels = (f, t) => { const c = createCanvas(320, 180), g = c.getContext('2d'); renderFrame(g, f, t, { env, look: 'chalk', width: 320, height: 180, endFade: false }); return c.data(); };
  const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 18 || Math.abs(a[i + 1] - b[i + 1]) > 18) n++; return n; };

  // caps warn, and the new limits hold
  const many = (n) => Array.from({ length: n }, () => ({ type: 'star', x: 0.5, y: 0.5 }));
  let r = film([shot({ props: many(170), actors: [{ id: 'a', do: Array.from({ length: 70 }, (_, i) => ({ at: i * 0.01, mood: 'happy' })) }] })]);
  check('caps: props and do over the cap warn', r.warnings.some((w) => /props: 170 items/.test(w)) && r.warnings.some((w) => /do events: 70 items/.test(w)), r.warnings.length + ' warnings');
  check('caps: 160 props kept', r.story.shots[0].props.length === 160);
  r = film([shot({ props: many(60) })]);
  check('caps: under the cap is silent', !r.warnings.length && r.story.shots[0].props.length === 60);

  // look: head and face move, seated, in every view, eased
  for (const face of ['right', 'left', 'front']) {
    r = film([shot({ actors: [{ id: 'a', x: 0.5, sit: 'chair', face, do: [{ at: 1, look: 'down', lookDur: 1 }] }], props: [{ type: 'chair', x: 0.5 }] })]);
    const h = (t) => inspectFrame(r.f, t).actors.a.joints.head;
    const a = h(0.5), m = h(1.5), b = h(2.5);
    check(`look: seated head goes down, eased (${face})`, b.y > a.y + 3 && m.y > a.y && m.y < b.y, `${a.y.toFixed(1)} ${m.y.toFixed(1)} ${b.y.toFixed(1)}`);
    check(`look: the face changes on screen (${face})`, differ(pixels(r.f, 0.5), pixels(r.f, 2.5)) > 0);
  }

  // seated gestures keep the hips and feet where sitting put them
  const seat = (pose) => film([shot({ actors: [{ id: 'a', x: 0.5, sit: 'chair', face: 'right', pose }], props: [{ type: 'chair', x: 0.5 }] })]).f;
  const js = (f) => inspectFrame(f, 1).actors.a.joints, base = js(seat('sit'));
  for (const pose of ['recoil', 'shrug', 'point', 'stand']) {
    const j = js(seat(pose));
    check(`seated: ${pose} keeps hips and feet`, Math.abs(j.hip.y - base.hip.y) < 2 && Math.abs(j.rl[2].y - base.rl[2].y) < 2);
  }
  // face and close cameras find a seated head
  for (const kind of ['face', 'close']) {
    r = film([shot({ camera: { shot: kind, on: 'a', move: 'static' }, actors: [{ id: 'a', x: 0.5, sit: 'chair', face: 'right' }], props: [{ type: 'chair', x: 0.5 }] })]);
    const q = inspectFrame(r.f, 1), h = q.actors.a.joints.head, p = q.project(h.x, h.y);
    check(`seated: ${kind} camera has the head in frame`, p.y > 0 && p.y < 1080 && p.x > 0 && p.x < 1920, `head at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
  }

  // front view: no hand ends down the middle of the body
  for (const pose of ['stand', 'lookUp', 'sad', 'tired', 'cheer', 'kneelDown']) {
    r = film([shot({ actors: [{ id: 'a', x: 0.5, face: 'front', pose }] })]);
    const j = inspectFrame(r.f, 1).actors.a.joints, hip = j.hip, S = 1;
    const stub = (q) => Math.abs(q.x - hip.x) < 20 * S && Math.abs(q.y - hip.y) < 40 * S;
    check(`front arms: ${pose} clear of the crotch`, !stub(j.la[2]) && !stub(j.ra[2]));
    check(`front arms: ${pose} on their own sides`, j.la[2].x < hip.x + 8 && j.ra[2].x > hip.x - 8);
  }

  // grips: one hand only, interpolated
  r = film([shot({ actors: [{ id: 'a', x: 0.46, face: 'right', do: [{ at: 1, grip: { hand: 'near', x: 0.5, y: 0.6, dur: 1 } }] }] })]);
  const ra = (t) => inspectFrame(r.f, t).actors.a.joints.ra[2], la = (t) => inspectFrame(r.f, t).actors.a.joints.la[2];
  check('grip: the near hand moves gradually', Math.abs(ra(1.5).x - ra(0.9).x) > 3 && Math.abs(ra(2.1).x - ra(1.5).x) > 3);
  check('grip: the other hand stays', Math.abs(la(2.1).x - la(0.9).x) < 6);
  check('grip: reaches its point', Math.hypot(ra(2.5).x - 960, ra(2.5).y - 648) < 2, `${ra(2.5).x.toFixed(0)},${ra(2.5).y.toFixed(0)}`);
  // old form still steps with both hands
  r = film([shot({ actors: [{ id: 'a', x: 0.47, face: 'right', do: [{ at: 1, grip: { x: 0.5, y: 0.6 } }] }] })]);
  check('grip: a plain {x, y} still steps with both hands', Math.abs(inspectFrame(r.f, 1.001).actors.a.joints.ra[2].x - 966) < 2 && Math.abs(inspectFrame(r.f, 1.001).actors.a.joints.la[2].x - 954) < 2);

  // hold
  const held = (o) => film([shot({ actors: [{ id: 'a', x: 0.5, pose: 'hold', hold: 'umbrella', holdSize: 1, ...o }] })]).f;
  check('hold: holdOpts reach the prop', differ(pixels(held({ face: 'right' }), 1), pixels(held({ face: 'right', holdOpts: { lopsided: true } }), 1)) > 0);
  const hy = (o) => { const j = inspectFrame(held(o), 1).actors.a.joints; return o.face === 'left' ? j.la[2].y : j.ra[2].y; };
  check('hold: the raised hand is the near hand facing left too', Math.abs(hy({ face: 'left' }) - hy({ face: 'right' })) < 4);

  // line, hand:false, hardUntil, delay
  r = film([shot({ props: [{ type: 'line', points: [[0.1, 0.5], [0.9, 0.5]], color: '#ff0000', width: 10, reveal: { at: 1, dur: 2 } }] })]);
  const none = film([shot({})]).f;
  const lineAt = (t) => differ(pixels(r.f, t), pixels(none, t));
  check('line: strokes on', lineAt(0.5) === 0 && lineAt(2) > 0 && lineAt(3.5) > lineAt(2), `${lineAt(0.5)} ${lineAt(2)} ${lineAt(3.5)}`);
  r = film([shot({ props: [{ type: 'hand', stroke: [[0.1, 0.5], [0.2, 0.5]], hand: false, dur: 0.001, lineColor: '#ff0000' }] })]);
  const r2 = film([shot({ props: [{ type: 'hand', stroke: [[0.1, 0.5], [0.2, 0.5]], dur: 0.001, lineColor: '#ff0000' }] })]);
  check('hand: hand:false leaves only the line', differ(pixels(r.f, 1), pixels(r2.f, 1)) > 50 && differ(pixels(r.f, 0), pixels(none, 0)) > 0);
  r = film([shot({ props: [{ type: 'star', x: 0.5, y: 0.5, hardUntil: 1 }] })]);
  check('prop: hardUntil is gone at once', differ(pixels(r.f, 0.99), pixels(none, 0.99)) > 0 && differ(pixels(r.f, 1.001), pixels(none, 1.001)) === 0);
  r = film([shot({ props: [{ type: 'star', x: 0.2, y: 0.5, to: { x: 0.8 }, delay: 2, dur: 1 }] })]);
  const sx = (t) => inspectFrame(r.f, t).props[0].x;
  check('prop: a delayed "to" waits', sx(1.9) === sx(0) && sx(2.5) > sx(0) && Math.abs(sx(3.5) - 0.8 * 1920) < 1);
  r = film([shot({ props: [{ type: 'star', x: 0.2, y: 0.5, path: [{ at: 1, x: 0.5, dur: 1 }, { at: 3, x: 0.3, dur: 0.5 }] }] })]);
  check('prop: path visits its keys', Math.abs(inspectFrame(r.f, 2.5).props[0].x - 960) < 1 && Math.abs(inspectFrame(r.f, 3.9).props[0].x - 576) < 1);

  // body moves
  r = film([shot({ actors: [{ id: 'a', x: 0.5, face: 'right', do: [{ at: 1, legsFold: true, dur: 1 }] }] })]);
  let rises = 0, prev = null;
  for (let t = 0.9; t < 2.1; t += 1 / 60) { const y = inspectFrame(r.f, t).actors.a.joints.head.y; if (prev != null && y < prev - 0.6) rises++; prev = y; }
  const yA = inspectFrame(r.f, 0.9).actors.a.joints.head.y, yB = inspectFrame(r.f, 2.2).actors.a.joints.head.y;
  check('legsFold: the head only goes down', rises === 0 && yB > yA + 40, `${(yB - yA).toFixed(0)} px`);
  const jk = inspectFrame(r.f, 2.5).actors.a.joints;
  check('kneelDown: both knees on the ground', Math.abs(jk.ll[1].y - jk.rl[1].y) < 6 && 864 - jk.ll[1].y < 16, `${(885.6 - jk.ll[1].y).toFixed(1)}`);
  r = film([shot({ actors: [{ id: 'a', x: 0.7, face: 'right', do: [{ at: 0.5, walkTo: 0.5, back: true }] }] })], 6);
  const b0 = inspectFrame(r.f, 0.2).actors.a, b1 = inspectFrame(r.f, 1).actors.a, b2 = inspectFrame(r.f, 3.5).actors.a;
  check('back step: travels backward, still facing', b1.f === 1 && b2.f === 1 && b1.x < b0.x && Math.abs(b2.x - 960) < 1);
  // the same plant-and-swing test the gait tool applies, on a backward walk
  let drift = 0, lastX = { ll: null, rl: null };
  for (let t = 0.6; t < 2; t += 1 / 120) {
    const A = inspectFrame(r.f, t).actors.a;
    if (!A.gait) continue;
    for (const k of ['ll', 'rl']) { if (A.gait[k].phase === 'stance') { const x = A.joints[k][2].x; if (lastX[k] != null) drift = Math.max(drift, Math.abs(x - lastX[k])); lastX[k] = x; } else lastX[k] = null; }
  }
  check('back step: planted feet stay planted', drift < 1, `${drift.toFixed(2)} px per sample`);
  r = film([shot({ actors: [{ id: 'a', x: 0.45, face: 'right', pose: 'stand', do: [{ at: 1, pose: 'point', poseDur: 2 }] }] })]);
  const pa = (t) => inspectFrame(r.f, t).actors.a.joints.ra[2].y;
  check('poseDur: a pose change takes its time', pa(1.3) > pa(2) && pa(2) > pa(3.2), `${pa(1.3).toFixed(0)} ${pa(2).toFixed(0)} ${pa(3.2).toFixed(0)}`);
  r = film([shot({ actors: [{ id: 'a', x: 0.45, face: 'right', pose: 'crouch', do: [{ at: 1, carry: 'b', liftDur: 1.5, pose: 'carry', poseDur: 1.5 }] }, { id: 'b', x: 0.5, pose: 'lie', face: 'right' }] })], 5);
  const by = (t) => inspectFrame(r.f, t).actors.b.y;
  check('carry: liftDur rises gradually', Math.abs(by(1.4) - by(0.9)) < 1 && by(1.8) < by(1.4) - 5 && by(2.2) < by(1.8) - 5, `${by(1.4).toFixed(0)} ${by(1.8).toFixed(0)} ${by(2.2).toFixed(0)} ${by(3).toFixed(0)}`);

  // camera, dissolve, rain, overlays
  r = film([shot({ camera: { x: 0.25, y: 0.3, zoom: 2, to: { x: 0.75, y: 0.3, zoom: 3, at: 1, dur: 2 } } })]);
  const c = (t) => inspectFrame(r.f, t).cam;
  check('camera: explicit target and move', c(0.5).z === 2 && Math.abs(c(0.5).cx - 480) < 1 && Math.abs(c(3.5).cx - 1440) < 1 && Math.abs(c(3.5).z - 3) < 1e-6 && c(2).z > 2 && c(2).z < 3);
  const twoShots = [shot({ end: 2, set: 'space' }), { ...shot({ set: 'void', transition: 'dissolve', transitionDur: 1 }), id: 't', start: 2, end: 4 }];
  r = film(twoShots);
  const r3 = film([{ ...twoShots[1], transition: 'cut', start: 0, end: 4 }]);
  const p0 = pixels(r.f, 1.99), pm = pixels(r.f, 2.5), pe = pixels(r.f, 3.5), pc = pixels(r3.f, 1.5);
  check('dissolve: mixes the two shots, then settles', differ(pm, pe) > 100 && differ(pm, p0) > 100 && differ(pe, pc) === 0);
  const rainy = (clear) => film([shot({ fx: [{ type: 'rain', density: 3, ...clear }], actors: [] })]).f;
  const inZone = (a) => { let n = 0; const b = rainy({}); const d = pixels(b, 1); for (let y = 60; y < 170; y++) for (let x = 110; x < 210; x++) { const i = (y * 320 + x) * 4; if (Math.abs(a[i] - d[i]) > 8) n++; } return n; };
  check('rain: a clear zone removes the rain inside it', inZone(pixels(rainy({ clear: { x0: 0.3, x1: 0.7, y0: 0.3 } }), 1)) > 50);
  check('rain: layer back draws', differ(pixels(rainy({ layer: 'back' }), 1), pixels(none, 1)) > 0);
  r = film([shot({ actors: [{ id: 'a', ride: 'bike', do: [{ at: 1, face: 'left' }] }], props: [{ type: 'bike', x: 0.5 }] })]);
  check('rider: a face event changes the drawing, not the body', differ(pixels(r.f, 0.5), pixels(r.f, 2)) > 0 && inspectFrame(r.f, 2).actors.a.f === 1);
  r = film([shot({ text: [{ type: 'label', text: 'hi', x: 0.5, y: 0.5, enter: false }] })]);
  check('overlay: enter:false is settled from its first frame', differ(pixels(r.f, 0), pixels(r.f, 1)) === 0);
  r = film([shot({ fx: [{ type: 'lightning', at: 2 }] })]);
  check('lightning fires on its cue', differ(pixels(r.f, 1), pixels(r.f, 2.03)) > 500 && differ(pixels(r.f, 1), pixels(r.f, 2.5)) === 0);
}

const major = +process.versions.node.split('.')[0];
check('Node.js 20+', major >= 20, process.version);
const ff = findFfmpeg();
check('ffmpeg found', !!ff, ff ? ff.version : 'install ffmpeg (see README)');

setupFonts();
featureChecks();

// Long videos in copy & paste mode: split, check each reply, carry the cast, merge.
function partsChecks() {
  // about 190 s of narration: a sentence of 8 words every 3.2 s
  const words = [];
  for (let t = 0, i = 0; t < 188; t += 0.4, i++) words.push({ text: `word${i}${i % 8 === 7 ? '.' : ''}`, start: +t.toFixed(2), end: +(t + 0.35).toFixed(2) });
  const duration = 190;
  check('parts: 73 s stays one prompt, 190 s does not', !needsParts(73) && needsParts(190));
  const plan = newPlan(words, duration);
  const ps = plan.parts;
  check('parts: 190 s splits into 3 of about a minute', ps.length === 3 && ps.every((x) => x.end - x.start > 45 && x.end - x.start < 80), ps.map((x) => (x.end - x.start).toFixed(1)).join(' '));
  check('parts: no gaps, from 0 to the end', ps[0].start === 0 && ps[2].end === duration && ps[0].end === ps[1].start && ps[1].end === ps[2].start);
  const lastBefore = (t) => words.filter((w) => w.start < t).pop();
  check('parts: cut where a sentence ends', ps.slice(0, -1).every((x) => lastBefore(x.end).text.endsWith('.')));
  check('parts: every word lands in exactly one part', words.every((w) => ps.filter((x) => w.start >= x.start && w.start < x.end).length === 1));
  const titled = words.map((w, i) => ({ ...w, text: i === 158 ? 'Mr.' : w.text.replace('.', '') })); // the only full stop is near the first even split
  titled[150].text = 'done.';
  check('parts: "Mr." is not the end of a sentence', titled.filter((w) => w.start < splitParts(titled, duration)[0].end).pop().text === 'done.');
  check('parts: a long video with no punctuation still splits', splitParts(words.map((w) => ({ ...w, text: 'word' })), duration).length === 3);
  check('parts: changing the words changes the key', partsKey(words, duration) !== partsKey(words.slice(1), duration));

  const full = (part, n, cast = []) => {
    const count = n * 4 + 8, each = (part.end - part.start) / count;
    return { cast, music: [{ start: part.start, end: part.end, mood: n === 2 ? 'tense' : 'wonder', intensity: 0.5 }], shots: Array.from({ length: count }, (_, i) => ({ id: `s${i + 1}`, start: part.start + i * each, end: part.start + (i + 1) * each, set: 'park', scene: `scene ${i}`, actors: [{ id: 'you', x: 0.5 }] })) };
  };
  const r1 = checkPartReply(full(ps[0], 1, [{ id: 'You', name: 'You', color: '#ff5a3c' }]), ps[0]);
  check('parts: a full reply is ok', r1.status === 'ok' && !r1.issue);
  const cut = full(ps[0], 1); cut.shots = cut.shots.slice(0, 3);
  const rs = checkPartReply(cut, ps[0]);
  check('parts: a reply that stops early is flagged short', rs.status === 'short' && /covers only/.test(rs.issue), rs.issue);
  const sparse = { shots: [{ start: ps[0].start, end: ps[0].end, set: 'park' }, { start: ps[0].end - 1, end: ps[0].end, set: 'park' }] };
  check('parts: too few shots is flagged short', checkPartReply(sparse, ps[0]).status === 'short');
  check('parts: no shots is flagged broken', checkPartReply({ title: 'x' }, ps[0]).status === 'broken');
  check('parts: shots from another part are flagged broken', checkPartReply(full(ps[2], 1), ps[0]).status === 'broken');
  const clock = full({ start: 0, end: ps[1].end - ps[1].start }, 2);
  const shifted = checkPartReply(clock, ps[1]);
  check('parts: a clock restarted at 0 is moved to the part', shifted.status === 'ok' && shifted.shots[0].start === ps[1].start && shifted.shots[shifted.shots.length - 1].end === ps[1].end);
  const messy = full(ps[1], 2);
  messy.shots[2].end += 5; messy.shots[5].end -= 0.5; messy.shots[0].start += 0.4;
  const tidy = checkPartReply(messy, ps[1]).shots;
  check('parts: overlaps and gaps in a reply are closed', tidy[0].start === ps[1].start && tidy.every((s, i) => i === 0 || s.start === tidy[i - 1].end));

  Object.assign(ps[0], r1);
  const carry = carryFrom(plan, 2);
  const prompt = partPrompt({ aspect: '16:9', duration, look: 'ember', title: 'T', words, part: ps[1], total: 3, carry });
  check('parts: the next prompt carries cast, locations and music', /"id":"you"/.test(prompt) && /Locations so far/.test(prompt) && /"mood":"wonder"/.test(prompt));
  check('parts: the prompt holds only its own transcript', prompt.includes(`word${words.findIndex((w) => w.start >= ps[1].start)}`) && !/word0@/.test(prompt) && !prompt.includes(`word${words.length - 1}@`));
  check('parts: the prompt says where to start and stop', prompt.includes(`exactly ${ps[1].start.toFixed(2)}`) && prompt.includes(`exactly ${ps[1].end.toFixed(2)}`));
  const big = { title: 'T', tone: 'calm', characters: [], facts: [{ fact: 'x'.repeat(4000) }] };
  check('parts: the prompt leaves out the long story notes', !partPrompt({ aspect: '16:9', duration, look: 'ember', words, part: ps[1], total: 3, carry, breakdown: big }).includes('xxxx'));
  check('parts: compact director prompt is smaller and keeps the catalog', directorSystem(null, { compact: true }).length < directorSystem().length - 4000 && /## poses/.test(directorSystem(null, { compact: true })) && !/Hands: "grip"/.test(directorSystem(null, { compact: true })) && /Hands: "grip"/.test(directorSystem()));

  Object.assign(ps[1], shifted);
  Object.assign(ps[2], checkPartReply(full(ps[2], 3, [{ id: 'you', color: '#000000' }, { id: 'Sister', name: 'Sister' }]), ps[2]));
  const merged = mergeParts(plan, duration);
  const v = validateStoryboard(merged, { duration, framing: false });
  const shots = v.story.shots;
  check('parts: merged shots have no gaps or overlaps', shots[0].start === 0 && shots[shots.length - 1].end === duration && shots.every((s, i) => i === 0 || s.start === shots[i - 1].end));
  check('parts: merged shot ids are unique', new Set(shots.map((s) => s.id)).size === shots.length);
  check('parts: nothing lost at the joins', shots.length === ps[0].shots.length + ps[1].shots.length + ps[2].shots.length, `${shots.length} shots`);
  check('parts: cast keeps its first look and adds newcomers', v.story.cast.length === 2 && v.story.cast[0].color === '#ff5a3c' && v.story.cast[1].id === 'sister');
  check('parts: music runs the whole video with no gaps', v.story.music[0].start === 0 && v.story.music[v.story.music.length - 1].end === duration && v.story.music.every((m, i) => i === 0 || m.start === v.story.music[i - 1].end), v.story.music.map((m) => m.mood).join(' '));
  check('parts: the merge does not touch the saved parts', ps[0].shots[0].id === 's1' && !('_order' in ps[0].shots[0]));
}
partsChecks();
const ex = JSON.parse(fs.readFileSync(new URL('../examples/pause-button.json', import.meta.url), 'utf8'));
const { story, warnings } = validateStoryboard(ex.storyboard, { duration: ex.duration });
check('example storyboard is valid', warnings.length === 0, warnings.join('; '));
const words = estimateWords(ex.script);
check('timing estimate', words.length > 50, `${words.length} words`);

for (const look of LOOK_IDS) {
  const film = compileFilm(story, { aspect: '16:9', look, words, captions: true, duration: ex.duration });
  const c = createCanvas(480, 270);
  let ok = true;
  try { for (const s of film.shots) renderFrame(c.getContext('2d'), film, (s.start + s.end) / 2, { env }); } catch (e) { ok = false; console.error(e); }
  check(`render every shot in "${look}"`, ok);
}
const vfilm = compileFilm(story, { aspect: '9:16', look: 'candy', words, captions: true, duration: ex.duration });
let vok = true;
try { renderFrame(createCanvas(270, 480).getContext('2d'), vfilm, 5, { env }); } catch (e) { vok = false; console.error(e); }
check('vertical 9:16 frame', vok);

// Text layout: line breaks are honoured, long text wraps, and every glyph stays inside
// its container. Text pixels = difference between a frame drawn with and without the text.
{
  const inkBox = (a, b, w) => {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) < 60) continue;
      const p = i / 4, x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  };
  const inside = (b, r) => !!b && b.x0 >= r.x0 && b.y0 >= r.y0 && b.x1 <= r.x1 && b.y1 <= r.y1;
  const fmt = (b) => (b ? `ink ${b.x0},${b.y0}-${b.x1},${b.y1}` : 'no ink');
  const P = palette('ember');
  const propInk = (type, txt, x, y, size) => {
    const draw = (t) => { const c = createCanvas(800, 600), g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, 800, 600); drawProp(g, type, x, y, size, P, 0, t ? { text: t } : {}); return g.getImageData(0, 0, 800, 600).data; };
    return inkBox(draw(txt), draw(null), 800);
  };
  const g0 = createCanvas(10, 10).getContext('2d');
  const L = layoutText(g0, 'RULES\n1. ___\n2. ___\n3. ___', { w: 235, h: 134 }, { maxSize: 36 });
  check('text layout honours line breaks', L.lines.length === 4 && L.height <= 134 && L.width <= 235, `${L.lines.length} lines at ${L.size.toFixed(1)}px`);
  const W2 = layoutText(g0, 'a long sentence that has to wrap onto several lines', { w: 120, h: 200 }, { maxSize: 20 });
  check('text layout wraps long text', W2.lines.length > 1 && W2.width <= 120 && !W2.truncated, `${W2.lines.length} lines`);
  // Board (inner area 280x160) drawn at (400,300), size 2.
  const b = propInk('board', 'RULES\n1. ___\n2. ___\n3. ___', 400, 300, 2);
  check('board text stays inside the board', inside(b, { x0: 400 - 280, y0: 300 - 160, x1: 400 + 280, y1: 300 + 160 }) && b.y1 - b.y0 > 160, fmt(b));
  // Sign plank (160x70, 130..200 above the ground point) drawn at (400,560), size 2.
  const s = propInk('sign', 'PLEASE KEEP OFF THE WET PAINT UNTIL TOMORROW', 400, 560, 2);
  check('long sign text stays inside the sign', inside(s, { x0: 400 - 160, y0: 560 - 400, x1: 400 + 160, y1: 560 - 260 }), fmt(s));
  // Graphics near the frame edge stay inside the 5% safe area.
  const frameInk = (text) => {
    const shot = (t) => ({ start: 0, end: 4, set: 'void', text: t });
    const draw = (t) => {
      const { story } = validateStoryboard({ shots: [shot(t)] }, { duration: 4 });
      const film = compileFilm(story, { aspect: '16:9', look: 'ember', words: [], captions: false, duration: 4 });
      const c = createCanvas(960, 540); renderFrame(c.getContext('2d'), film, 2.6, { env, endFade: false });
      return c.getContext('2d').getImageData(0, 0, 960, 540).data;
    };
    return inkBox(draw([text]), draw([]), 960);
  };
  const safe = { x0: 48 - 2, y0: 27 - 2, x1: 960 - 48 + 2, y1: 540 - 27 + 2 };
  for (const [name, o] of [
    ['label', { type: 'label', text: 'THE RULE: IT ONLY WORKS ONCE A WEEK FOR YOU', x: 0.95, y: 0.1, at: 0 }],
    ['list', { type: 'list', items: ['1. TEN SECONDS ONLY', '2. ONE TIME EACH DAY, NO EXCEPTIONS', '3. NO REFUNDS'], x: 0.82, y: 0.25, step: 0.2, at: 0 }],
    ['stamp', { type: 'stamp', text: 'PAUSED FOR NOW', x: 0.62, y: 0.3, at: 0 }],
    ['title', { type: 'title', text: 'WHAT IF YOU COULD PAUSE THE WHOLE WORLD?', at: 0 }],
  ]) {
    const ink = frameInk(o);
    check(`${name} graphic stays inside the safe area`, inside(ink, safe), fmt(ink));
  }
}

// Motion and framing: surfaces, followers, camera framing of props, fx/dip easing, prop options.
{
  const film = (shots, d = 4) => compileFilm(validateStoryboard({ shots }, { duration: d, framing: false }).story, { aspect: '16:9', look: 'ember', words: [], duration: d });
  const shot = (o) => ({ start: 0, end: 4, set: 'void', camera: { shot: 'wide', move: 'static' }, ...o });
  const at = (f, t) => inspectFrame(f, t);
  const near = (a, b, e = 1) => Math.abs(a - b) <= e;
  const W = 1920, H = 1080, GY = 1080 * 0.82;
  // 1. elevation: standing on a bridge deck, climbing onto it, sitting on a couch, y on a move
  {
    const f = film([shot({ actors: [{ id: 'a', x: 0.5, on: 'bridge' }, { id: 'b', x: 0.5 }, { id: 'c', x: 0.1, on: 'bridge', do: [{ at: 0, walkTo: 0.45, dur: 3 }] }], props: [{ type: 'bridge', x: 0.5 }] })]);
    const deck = GY - 70 * 1.6 * 1.5;
    const ys = Array.from({ length: 65 }, (_, i) => at(f, i * 0.05).actors.c.y);
    const climbs = ys.every((y, i) => i === 0 || y <= ys[i - 1] + 1e-6) && near(ys[0], GY) && near(ys[64], deck) && ys.filter((y) => y < GY - 5 && y > deck + 5).length >= 3;
    const s0 = at(f, 1);
    check('actor stands on a prop surface and climbs onto it', near(s0.actors.a.y, deck) && near(s0.actors.b.y, GY) && climbs, `deck ${s0.actors.a.y.toFixed(0)}, ${ys.filter((y) => y < GY - 5 && y > deck + 5).length} frames on the ramp`);
    const g = film([shot({ actors: [{ id: 'a', x: 0.3, sit: 'couch' }, { id: 'b', x: 0.5, do: [{ at: 0, moveTo: 0.6, y: 0.5, dur: 1 }] }], props: [{ type: 'couch', x: 0.5 }] })]);
    const q = at(g, 0.5), r = at(g, 2);
    const sx = q.actors.a.x / W;
    check('seated actor is kept on the seat; move y is interpolated', sx > 0.42 && sx < 0.58 && q.actors.a.y <= GY && near(r.actors.b.y, 540) && q.actors.b.y < GY - 50 && q.actors.b.y > 545, `seat x ${sx.toFixed(3)}, y ${q.actors.b.y.toFixed(0)} -> ${r.actors.b.y.toFixed(0)}`);
  }
  // 2. with: a follower tracks its leader, is set down on release; linear glide
  {
    const f = film([shot({ actors: [{ id: 'l', x: 0.2, do: [{ at: 0, walkTo: 0.8, dur: 2 }] }, { id: 'c', x: 0.5, pose: 'lie', with: { id: 'l', dx: 0.05, dy: -0.1 }, do: [{ at: 2.5, with: null }] }, { id: 'g', x: 0.2, do: [{ at: 0, moveTo: 0.6, dur: 2, ease: 'linear' }] }] })]);
    const a = at(f, 1), b = at(f, 3.5);
    const dx = a.actors.c.x - a.actors.l.x, dy = a.actors.c.y - a.actors.l.y;
    check('"with" follows the leader and settles on release', near(dx, 0.05 * W) && near(dy, -0.1 * H) && near(b.actors.c.y, GY) && near(b.actors.c.x, b.actors.l.x + 0.05 * W, 2), `offset ${dx.toFixed(0)},${dy.toFixed(0)}; released at y ${b.actors.c.y.toFixed(0)}`);
    check('moveTo with ease "linear"', near(a.actors.g.x, 0.4 * W), `${a.actors.g.x.toFixed(1)}`);
  }
  // 3. camera includes cued props in medium shots; validator warns about props outside the frame
  {
    const sb = (fit) => [shot({ camera: { shot: 'medium', on: 'a', move: 'push', ...(fit ? {} : { fit: false }) }, actors: [{ id: 'a', x: 0.4 }], props: [{ type: 'thought', x: 0.62, y: 0.25, at: 0.5, text: 'IDEA' }] })];
    const inFrame = (f) => { const s = at(f, 3.9), p = s.project(s.props[0].x, s.props[0].y), a = s.project(s.actors.a.x, s.actors.a.y); return p.x > 0 && p.x < W && p.y > 0 && p.y < H && a.y <= H && a.y > H * 0.5; };
    const warned = validateStoryboard({ cast: [{ id: 'a' }], shots: sb(false) }, { duration: 4 }).warnings.some((w) => /outside the medium frame/.test(w));
    const clean = validateStoryboard({ cast: [{ id: 'a' }], shots: sb(true) }, { duration: 4 }).warnings.length === 0;
    check('medium shot widens to include a cued prop', inFrame(film(sb(true))) && !inFrame(film(sb(false))) && warned && clean);
  }
  // 4. insert framing centres a tall prop on its visual middle
  {
    const f = film([shot({ camera: { shot: 'insert', on: 'sign', move: 'static' }, props: [{ type: 'sign', x: 0.5, text: 'STOP' }] })]);
    const c = at(f, 1).cam;
    check('insert on a tall prop frames its middle', near(c.cy, GY - 100 * 1.5) && H / c.z >= 200 * 1.5 * 0.9, `cy ${c.cy.toFixed(0)}, z ${c.z.toFixed(2)}`);
  }
  // 5. lighting fx cued mid-shot ease in; lightning stays instant
  {
    const f = film([shot({ fx: [{ type: 'spotlight', at: 1 }] })]);
    const lum = (t) => { const c = createCanvas(160, 90), g = c.getContext('2d'); renderFrame(g, f, t, { env, endFade: false }); const d = g.getImageData(0, 0, 160, 90).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; };
    const before = lum(0.9), start = lum(1.02), full = lum(1.6);
    check('spotlight eases in instead of snapping', start > full + (before - full) * 0.6 && screenFxFade('lightning', { age: 0 }) === 1 && screenFxFade('night', { age: 0.1 }) < 0.5, `lum ${before.toFixed(1)} / ${start.toFixed(1)} / ${full.toFixed(1)}`);
  }
  // 6. a dip transition eases the outgoing shot down to black
  {
    const f = film([shot({ start: 0, end: 2, set: 'park' }), shot({ start: 2, end: 4, set: 'park', transition: 'dip' })]);
    const lum = (t) => { const c = createCanvas(160, 90), g = c.getContext('2d'); renderFrame(g, f, t, { env, endFade: false }); const d = g.getImageData(0, 0, 160, 90).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; };
    const a = lum(1.5), b = lum(1.85), c = lum(1.99);
    check('dip pre-roll fades to black before the cut', c < 8 && b < a && b > c, `lum ${a.toFixed(1)} > ${b.toFixed(1)} > ${c.toFixed(1)}`);
  }
  // 7. pop:false skips the pop scale; fly with "to" arrives before flying on
  {
    const f = film([shot({ props: [{ type: 'star', x: 0.3, y: 0.3, at: 0.5, pop: false }, { type: 'star', x: 0.5, y: 0.3, at: 0.5 }, { type: 'bird', x: 0.2, y: 0.5, at: 0, anim: 'fly', to: { x: 0.6, y: 0.4 }, dur: 1 }] })]);
    const s = at(f, 0.55), e = at(f, 1.0);
    check('pop:false appears without the pop scale', near(s.props[0].size, e.props[0].size, 1e-6) && s.props[1].size < e.props[1].size * 0.8);
    const b = at(f, 1.0).props[2];
    check('fly with "to" reaches its target', near(b.x, 0.6 * W, 2) && near(b.y, 0.4 * H, 2), `${b.x.toFixed(0)},${b.y.toFixed(0)}`);
  }
  // 8. camera.on naming a prop (no actor) frames that prop
  {
    const f = film([shot({ camera: { shot: 'medium', on: 'rock', move: 'static' }, props: [{ type: 'rock', x: 0.3, size: 2 }, { type: 'campfire', x: 0.8 }] })]);
    const c = at(f, 1).cam;
    check('camera "on" a prop frames that prop', near(c.cx, 0.3 * W) && c.z > 1.5 && c.z < 1.7, `cx ${c.cx.toFixed(0)}, z ${c.z.toFixed(2)}`);
  }
}

// Story features: gait, reveal, tween, carry, ride, freeze, sagging plank, options kept by the validator.
{
  const cast = [{ id: 'a' }, { id: 'b', kid: true }];
  const film = (shots, d = 4) => compileFilm(validateStoryboard({ cast, shots }, { duration: d, framing: false }).story, { aspect: '16:9', look: 'chalk', words: [], duration: d });
  const shot = (o) => ({ start: 0, end: 4, set: 'void', camera: { shot: 'wide', move: 'static' }, ...o });
  const px = (f, t) => { const c = createCanvas(320, 180), g = c.getContext('2d'); renderFrame(g, f, t, { env, endFade: false }); return g.getImageData(0, 0, 320, 180).data; };
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++; return n; };
  const v = validateStoryboard({ shots: [shot({ props: [{ type: 'dog', legs: 3, fluffy: true, x: 0.5, reveal: 2, tween: [{ key: 'sag', to: 1, at: 0 }] }] })] }, { duration: 4, framing: false }).story.shots[0].props[0];
  check('validator keeps drawing options', v.legs === 3 && v.fluffy === true && v.reveal === 2 && Array.isArray(v.tween));
  const R = film([shot({ props: [{ type: 'sandwich', x: 0.5, y: 0.5, size: 2, reveal: { at: 1, dur: 1, tip: 'chalk', real: 0.5, realAt: 2.5 } }] })]);
  const blank = film([shot({})]);
  const a = diff(px(R, 0.5), px(blank, 0.5)), b = diff(px(R, 1.5), px(blank, 1.5)), c = diff(px(R, 2.3), px(blank, 2.3)), d = diff(px(R, 3.5), px(blank, 3.5));
  check('reveal: nothing, then lines drawing out, then solid', a === 0 && b > 0 && c > b && d > c, `${a} < ${b} < ${c} < ${d} px`);
  const T = film([shot({ props: [{ type: 'pancakes', x: 0.5, size: 2, tween: [{ key: 'count', from: 1, to: 6, at: 1, dur: 1 }] }] })]);
  check('tween animates a drawing option', diff(px(T, 0.5), px(T, 3)) > 40);
  const C = film([shot({ actors: [{ id: 'a', x: 0.3, pose: 'carry', do: [{ at: 0.5, carry: 'b' }, { at: 1.2, walkTo: 0.5, dur: 1.5 }, { at: 3.2, carry: null }] }, { id: 'b', x: 0.38 }] })]);
  const near = (t) => { const s = inspectFrame(C, t).actors, h = s.b.joints.hip, H = s.a.joints.hip; return { dx: h.x - H.x, dy: h.y - H.y, y: s.b.y }; };
  const q = near(2);
  check('carry: the carried body rides in the arms, then is set down', q.dx > 20 && q.dx < 90 && q.dy < 0 && Math.abs(inspectFrame(C, 3.9).actors.b.y - 1080 * 0.82) < 2, `offset ${q.dx.toFixed(0)},${q.dy.toFixed(0)}`);
  const B = film([shot({ props: [{ type: 'bike', x: 0.2, size: 0.82, to: { x: 0.8 }, dur: 3 }], actors: [{ id: 'b', x: 0.2, ride: 'bike' }] })]);
  const r = inspectFrame(B, 1.5), rp = r.props[0], ra = r.actors.b;
  check('ride: the rider stays on the bike and the bike moves', Math.abs(ra.x - rp.x) < 40 && rp.x > 0.2 * 1920 + 50 && ra.joints.ll[2].y > ra.joints.hip.y + 30, `rider ${ra.x.toFixed(0)}, bike ${rp.x.toFixed(0)}`);
  const F = film([shot({ actors: [{ id: 'a', x: 0.2, do: [{ at: 0, walkTo: 0.8, dur: 3 }] }], fx: ['rain', { type: 'freeze', at: 1, hero: false, tint: false }] })]);
  check('freeze holds rain and actors', diff(px(F, 1.5), px(F, 3)) < 30 && diff(px(F, 0.5), px(F, 0.9)) > 20);
  const D = (w) => { const f = film([shot({ props: [{ type: 'footbridge', x: 0.5 }], actors: [{ id: 'a', x: 0.5, on: 'footbridge', weight: w }] })]); return inspectFrame(f, 1).actors.a.y; };
  check('a plank dips under a heavy walker, barely under a light one', D(1) - D(0) > 5 && D(0.2) - D(0) < 3, `${(D(1) - D(0)).toFixed(1)} / ${(D(0.2) - D(0)).toFixed(1)} px`);
  const held = validateStoryboard({ shots: [shot({ actors: [{ id: 'a', pose: 'walk' }] })] }, { duration: 4, framing: false }).warnings;
  check('a stride held on the spot warns', held.some((m) => /walkTo/.test(m)));
}
try {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('./gait_test.mjs', import.meta.url))], { encoding: 'utf8', timeout: 300000 });
  check('gait: planted feet and paws do not slide (tools/gait_test.mjs)', /All gait checks passed/.test(out));
} catch (e) { check('gait: planted feet and paws do not slide (tools/gait_test.mjs)', false, String(e.stdout || e.message).split('\n').filter((l) => /FAIL/.test(l)).join('; ')); }

const missing = SFX_IDS.filter((s) => !SFX_NAMES.includes(s));
check('every catalog sound effect is synthesised', missing.length === 0, missing.join(', '));
check('sound effects produce audio', SFX_NAMES.every((n) => sfxBuffer(n)?.length > 100));

// Music duck: unducked the bed passes unchanged; ducked, a speech-band tone (1.5 kHz) dips the duck plus
// BAND_DUCK_DB while a low tone (150 Hz) only takes the broadband duck.
{
  const n = 4 * RATE, half = n / 2, ml = new Float32Array(n), duck = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ml[i] = 0.3 * Math.sin((2 * Math.PI * 150 * i) / RATE) + 0.3 * Math.sin((2 * Math.PI * 1500 * i) / RATE);
    duck[i] = i < half ? 1 : Math.pow(10, -DUCK_DEPTH_DB / 20);
  }
  const L = new Float32Array(n), R = new Float32Array(n);
  addDuckedMusic(L, R, ml, ml, duck, 1);
  const amp = (x, f, a) => { let s = 0, c = 0; for (let i = a; i < a + RATE / 2; i++) { const w = (2 * Math.PI * f * i) / RATE; s += x[i] * Math.sin(w); c += x[i] * Math.cos(w); } return (2 * Math.hypot(s, c)) / (RATE / 2); };
  const dbv = (x) => 20 * Math.log10(x);
  let same = 0;
  for (let i = RATE / 4; i < half - RATE / 4; i++) same = Math.max(same, Math.abs(L[i] - ml[i]));
  const lo = dbv(amp(L, 150, half + RATE) / amp(ml, 150, half + RATE)), hi = dbv(amp(L, 1500, half + RATE) / amp(ml, 1500, half + RATE));
  check('music duck: unchanged when not ducked', same < 1e-4, `max diff ${same.toExponential(1)}`);
  check('music duck: speech band dips deeper than the lows', Math.abs(lo + DUCK_DEPTH_DB) < 1 && Math.abs(hi + DUCK_DEPTH_DB + BAND_DUCK_DB) < 1.5 && R[half + RATE] === L[half + RATE],
    `150 Hz ${lo.toFixed(1)} dB, 1.5 kHz ${hi.toFixed(1)} dB`);
}

if (ff) {
  const out = path.join(os.tmpdir(), 'stickframe-selftest.mp4');
  const t0 = Date.now();
  try {
    await renderVideo({ project: { aspect: '16:9', resolution: '720p', fps: 24, look: 'ember', captions: true, storyboard: story, music: { mode: 'auto', volume: 0.5 }, sfx: true }, words, duration: ex.duration, out, from: 0, to: 4, scale: 0.5, preset: 'veryfast' });
    check('short video render', fs.statSync(out).size > 10000, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
    fs.rmSync(out, { force: true });
  } catch (e) { check('short video render', false, e.message); }

  // A float WAV with one wild sample decodes to the -1..1 range.
  {
    const wild = path.join(os.tmpdir(), 'stickframe-selftest-wild.wav');
    await run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_f32le', wild]);
    const b = fs.readFileSync(wild);
    b.writeFloatLE(20000, b.length - 400);
    fs.writeFileSync(wild, b);
    const pcm = await decodePcm(wild, 16000);
    check('wild samples are clamped when audio is decoded', Math.max(...pcm) <= 1 && Math.min(...pcm) >= -1 && pcm.some((v) => Math.abs(v) > 0.05));
    fs.rmSync(wild, { force: true });
  }

  // Sound library: a 1 kHz sample at 1.5 s, panned left, must land in the mix there (and not be a synth fallback).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sfxlib-'));
  try {
    await run(['-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.3', '-ac', '1', path.join(dir, 'beep.wav')]);
    fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ version: 1, sounds: { T1: { file: 'beep.wav', gain_db: 0, description: 'test beep', license: 'CC0' } } }));
    const lib = loadSfxLibrary(dir);
    check('sound library loads', !!lib?.ids.includes('T1'));
    const sb = { shots: [{ start: 0, end: 3, set: 'void', sfx: [{ sound: 'T1', at: 1.5, pan: -1 }, { sound: 'Whoosh', at: 0.2 }] }] };
    const kept = validateStoryboard(sb, { duration: 3, sfxIds: lib.ids }).story.shots[0].sfx;
    const dropped = validateStoryboard(sb, { duration: 3 }).story.shots[0].sfx || [];
    check('validator keeps library IDs', kept.some((x) => x.sound === 'T1' && x.pan === -1) && kept.some((x) => x.sound === 'whoosh') && !dropped.some((x) => x.sound === 'T1'));
    check('director prompt lists the library', /- T1: test beep/.test(directorSystem(lib)) && !/T1/.test(directorSystem()));
    const out = path.join(dir, 'mix.wav');
    const film = compileFilm({ shots: [{ start: 0, end: 3, set: 'void', sfx: kept.filter((x) => x.sound === 'T1') }] }, { duration: 3 });
    await mixAudio({ out, duration: 3, musicMode: 'none', sfx: film.sfx, sfxLibrary: dir });
    const pcm = fs.readFileSync(out).subarray(44), at = (c, i) => pcm.readFloatLE((i * 2 + c) * 4);
    const rms = (c, a, b) => { let e = 0; for (let i = Math.round(a * RATE); i < b * RATE; i++) e += at(c, i) ** 2; return Math.sqrt(e / ((b - a) * RATE)); };
    let zc = 0;
    for (let i = Math.round(1.55 * RATE); i < 1.75 * RATE; i++) if ((at(0, i) >= 0) !== (at(0, i - 1) >= 0)) zc++;
    const on = rms(0, 1.52, 1.78), hz = zc / 0.2 / 2;
    check('library sample mixed at its time', on > 0.1 && rms(0, 0.2, 1.45) < 1e-4 && rms(0, 1.9, 2.9) < 1e-4 && rms(1, 1.52, 1.78) < 0.01 && Math.abs(hz - 1000) < 30, `rms ${on.toFixed(3)}, ${Math.round(hz)} Hz`);
  } catch (e) { check('sound library mix', false, e.message); }
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
