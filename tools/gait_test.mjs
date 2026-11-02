// Measures the gaits: renders frames at 1080p and asserts that planted feet do not slide in world
// space, stay on the ground line, knees bend forward, and nothing pops at start or stop.
// Usage: node tools/gait_test.mjs [--out dir]   (with --out: also writes report and contact sheets)
import fs from 'node:fs';
import path from 'node:path';
import { compileFilm, renderFrame, validateStoryboard, inspectFrame } from '../engine/index.js';
import { dogPaws } from '../engine/props.js';
import { setupFonts, createCanvas, env } from '../server/canvas.js';

const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
setupFonts();
const FPS = 24, W = 1920, H = 1080, SOLE = 5.5, DRIFT = 2;
const cast = [{ id: 'a', color: '#F7D774', wear: ['scarf'] }, { id: 'kid', color: '#ff9a88', wear: ['ponytail'], kid: true, scale: 0.85 }, { id: 'pack', color: '#9fd8ff' }];
const story = (shots, d) => validateStoryboard({ cast, shots }, { duration: d, framing: false }).story;
const shot = (o) => ({ start: 0, end: 5, set: 'void', camera: { shot: 'wide', move: 'static' }, ...o });
const CASES = [
  { name: 'walk right', id: 'a', d: 5, shots: [shot({ actors: [{ id: 'a', x: 0.1, face: 'right', do: [{ at: 0.4, walkTo: 0.8, dur: 3.6 }] }] })] },
  { name: 'walk left, starts facing right', id: 'a', d: 5, shots: [shot({ actors: [{ id: 'a', x: 0.8, face: 'right', do: [{ at: 0.4, walkTo: 0.2 }] }] })] },
  { name: 'walk from front view', id: 'a', d: 5, shots: [shot({ actors: [{ id: 'a', x: 0.2, face: 'front', do: [{ at: 0.4, walkTo: 0.7 }] }] })] },
  { name: 'run right', id: 'a', d: 4, shots: [shot({ end: 4, actors: [{ id: 'a', x: 0.05, face: 'right', do: [{ at: 0.4, runTo: 0.9 }] }] })] },
  { name: 'exit run', id: 'a', d: 4, shots: [shot({ end: 4, actors: [{ id: 'a', x: 0.3, face: 'right', do: [{ at: 0.3, exit: 'right', run: true }] }] })] },
  { name: 'child-size walk', id: 'kid', d: 5, shots: [shot({ actors: [{ id: 'kid', x: 0.2, face: 'right', do: [{ at: 0.3, walkTo: 0.65 }] }] })] },
  { name: 'walk on a raised surface', id: 'a', d: 6, on: true, shots: [shot({ end: 6, props: [{ type: 'bridge', x: 0.5 }], actors: [{ id: 'a', x: 0.3, on: 'bridge', face: 'right', do: [{ at: 0.3, walkTo: 0.7, dur: 4 }] }] })] },
  { name: 'walk over a plank gap', id: 'a', d: 6, on: true, gap: 0.52, shots: [shot({ end: 6, props: [{ type: 'footbridge', x: 0.5, gap: 0.52 }], actors: [{ id: 'a', x: 0.28, on: 'footbridge', face: 'right', do: [{ at: 0.3, walkTo: 0.72 }] }] })] },
  { name: 'walk while holding', id: 'a', d: 5, shots: [shot({ actors: [{ id: 'a', x: 0.2, hold: 'cup', do: [{ at: 0.3, walkTo: 0.7 }] }] })] },
  { name: 'walk carrying a person', id: 'a', d: 5, shots: [shot({ actors: [{ id: 'a', x: 0.2, pose: 'carry', carry: 'kid', do: [{ at: 0.3, walkTo: 0.7 }] }, { id: 'kid', x: 0.2 }] })] },
  { name: 'walk with pose "walk" via moveTo', id: 'a', d: 5, shots: [shot({ actors: [{ id: 'a', x: 0.2, pose: 'walk', do: [{ at: 0.3, moveTo: 0.7, dur: 3 }] }] })] },
];
let failed = 0;
const report = {};
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };

for (const C of CASES) {
  const film = compileFilm(story(C.shots, C.d), { aspect: '16:9', look: 'chalk', duration: C.d });
  const N = Math.floor(C.d * FPS);
  const fr = [];
  for (let i = 0; i < N; i++) fr.push(inspectFrame(film, i / FPS).actors[C.id]);
  // planted-foot drift in world space, per contact (flat: ankle and toe; heel: ankle; toe: toe)
  let drift = 0, contacts = 0, maxGround = 0, knee = 0, kneeBad = 0, inGap = 0;
  for (const foot of ['ll', 'rl']) {
    let run = null;
    fr.forEach((a) => {
      const gi = a.gait?.[foot], j = a.joints[foot];
      if (!gi || gi.phase !== 'stance') { run = null; return; }
      if (!run || run.plant !== gi.plant) { run = { plant: gi.plant, ax: null, tx: null }; contacts++; }
      if (gi.pivot !== 'toe') { if (run.ax == null) run.ax = j[2].x; drift = Math.max(drift, Math.abs(j[2].x - run.ax)); }
      if (gi.pivot !== 'heel') { if (run.tx == null) run.tx = j[3].x; drift = Math.max(drift, Math.abs(j[3].x - run.tx)); }
      if (!C.on) maxGround = Math.max(maxGround, Math.abs((gi.pivot === 'toe' ? j[3].y : j[2].y) + SOLE * a.scale - a.y));
      if (C.gap && gi.pivot === 'flat' && Math.abs(j[2].x - C.gap * W) < 26) inGap++;
    });
  }
  fr.forEach((a) => {
    if (!a.gait) return;
    for (const foot of ['ll', 'rl']) {
      const [h, k, an] = a.joints[foot];
      knee++;
      if ((k.x - (h.x + an.x) / 2) * a.f < -0.5) kneeBad++;
    }
  });
  // pops: the largest frame-to-frame joint jump at start/stop against the steady part of the gait
  const moving = fr.map((a) => !!a.gait);
  const first = moving.indexOf(true), lastM = moving.lastIndexOf(true);
  const jump = (i) => {
    const a = fr[i - 1], b = fr[i];
    let m = 0;
    for (const k of ['ll', 'rl', 'la', 'ra']) for (let n = 0; n < a.joints[k].length; n++) m = Math.max(m, Math.hypot(a.joints[k][n].x - a.x - b.joints[k][n].x + b.x, a.joints[k][n].y - a.y - b.joints[k][n].y + b.y));
    return Math.max(m, Math.hypot(a.joints.head.x - a.x - b.joints.head.x + b.x, a.joints.head.y - a.y - b.joints.head.y + b.y));
  };
  const steady = [];
  for (let i = first + 12; i < lastM - 12; i++) steady.push(jump(i));
  const norm = steady.length ? Math.max(...steady) : 60;
  const edge = [];
  for (let i = Math.max(1, first - 1); i <= first + 3; i++) edge.push(jump(i));
  if (lastM + 3 < N && fr[lastM].x < W && fr[lastM].x > 0) for (let i = lastM - 2; i <= lastM + 3; i++) edge.push(jump(i));
  const pop = Math.max(...edge);
  report[C.name] = { contacts, driftPx: +drift.toFixed(3), groundPx: C.on ? null : +maxGround.toFixed(3), kneeBad, steadyMaxPx: +norm.toFixed(1), edgeMaxPx: +pop.toFixed(1) };
  check(`${C.name}: planted foot drift`, drift < DRIFT && contacts >= 2, `${drift.toFixed(3)} px over ${contacts} contacts`);
  if (!C.on) check(`${C.name}: foot on the ground line`, maxGround < DRIFT, `${maxGround.toFixed(3)} px`);
  check(`${C.name}: knees bend forward`, kneeBad === 0, `${kneeBad}/${knee}`);
  check(`${C.name}: no pop at start or stop`, pop <= norm * 1.15 + 2, `edge ${pop.toFixed(1)} px, steady max ${norm.toFixed(1)} px`);
  let moon = 0;
  fr.forEach((a, i) => { if (a.gait && i && Math.abs(a.x - fr[i - 1].x) > 0.3 && Math.sign(a.x - fr[i - 1].x) !== a.f) moon++; });
  check(`${C.name}: faces the direction of travel`, moon === 0, `${moon} frames`);
  if (C.gap) check(`${C.name}: no foot lands in the gap`, inGap === 0, `${inGap} frames`);
}

// Cross-check on real pixels: render 1080p frames, undo the camera, and follow the chalk of the
// planted foot along its row.
{
  const C = CASES[0];
  const film = compileFilm(story(C.shots, C.d), { aspect: '16:9', look: 'chalk', duration: C.d });
  const c = createCanvas(W, H), g = c.getContext('2d');
  let maxPx = 0, spans = 0;
  for (const foot of ['ll', 'rl']) {
    let run = null;
    for (let i = 0; i < C.d * FPS; i++) {
      const t = i / FPS, s = inspectFrame(film, t), a = s.actors[C.id], gi = a.gait?.[foot];
      if (!gi || gi.phase !== 'stance' || gi.pivot !== 'flat') { run = null; continue; }
      renderFrame(g, film, t, { env, endFade: false });
      const j = a.joints[foot];
      const sp = s.project(j[2].x, j[2].y), st = s.project(j[3].x, j[3].y);
      // skip frames where the other leg crosses this foot's row
      const o = a.joints[foot === 'll' ? 'rl' : 'll'];
      if (o.some((q) => Math.abs(q.x - j[2].x) < 60 && Math.abs(q.y - j[2].y) < 30)) continue;
      const x0 = Math.round(Math.min(sp.x, st.x) - 30), wid = 90, y = Math.round(sp.y);
      const row = g.getImageData(x0, y, wid, 1).data;
      // the bright run through the middle of the foot; its toe end
      const bright = (x) => x >= 0 && x < wid && row[x * 4] + row[x * 4 + 1] + row[x * 4 + 2] > 480;
      let x = Math.round((sp.x + st.x) / 2) - x0;
      if (!bright(x)) continue;
      while (bright(x + a.f)) x += a.f;
      const tip = x0 + x;
      const world = s.cam.cx + (tip - W / 2) / s.cam.z;
      if (!run || run.plant !== gi.plant) { run = { plant: gi.plant, x: world }; spans++; }
      maxPx = Math.max(maxPx, Math.abs(world - run.x));
    }
  }
  report.pixelCheck = { spans, driftPx: +maxPx.toFixed(2) };
  check('rendered pixels: flat foot stays put', maxPx < DRIFT && spans >= 2, `${maxPx.toFixed(2)} px over ${spans} contacts (1080p)`);
}

// A moving dog: paws planted in world space; three legs exactly.
{
  for (const [name, three] of [['dog', false], ['tripod', true]]) {
    const size = 1.5, D = 600 / size;
    let drift = 0, contacts = 0;
    const plants = {};
    for (let i = 0; i <= 80; i++) {
      const d = (D * i) / 80, paws = dogPaws({ _move: { d, D } }, three);
      for (const [k, p] of Object.entries(paws)) {
        if (p.phase !== 'stance') { plants[k] = null; continue; }
        const world = (p.x + d) * size;
        if (plants[k] == null) { plants[k] = world; contacts++; }
        drift = Math.max(drift, Math.abs(world - plants[k]));
      }
    }
    const nLegs = Object.keys(dogPaws({ _move: { d: 1, D } }, three)).length;
    report[`${name} paws`] = { contacts, driftPx: +drift.toFixed(3), legs: nLegs };
    check(`${name}: planted paw drift`, drift < DRIFT && contacts > 6, `${drift.toFixed(3)} px over ${contacts} contacts`);
    check(`${name}: leg count`, nLegs === (three ? 3 : 4), `${nLegs} legs`);
  }
}

// Validator warnings for a stride pose held on the spot.
{
  const w = (a) => validateStoryboard({ cast, shots: [shot({ actors: [a] })] }, { duration: 5, framing: false }).warnings;
  check('validator warns about "walk" pose with no move', w({ id: 'a', pose: 'walk' }).some((m) => /walk/.test(m)));
  check('validator accepts a walk with a move', !w({ id: 'a', pose: 'walk', do: [{ at: 0, walkTo: 0.9 }] }).length);
  check('validator accepts an explicit march', !w({ id: 'a', pose: 'walk', face: 'right', march: true }).length);
}

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'gait_report.json'), JSON.stringify(report, null, 1));
  const sheet = (name, shots, d, t0, t1, cols, n) => {
    const film = compileFilm(story(shots, d), { aspect: '16:9', look: 'chalk', duration: d });
    const tw = 640, th = 360, rows = Math.ceil(n / cols);
    const out = createCanvas(cols * tw, rows * th), sg = out.getContext('2d');
    const fc = createCanvas(tw, th), fg = fc.getContext('2d');
    for (let i = 0; i < n; i++) {
      const t = t0 + ((t1 - t0) * i) / (n - 1);
      renderFrame(fg, film, t, { env, width: tw, height: th, endFade: false });
      sg.drawImage(fc, (i % cols) * tw, Math.floor(i / cols) * th);
      sg.fillStyle = '#fff'; sg.font = '16px Rubik'; sg.fillText(`${t.toFixed(2)}s`, (i % cols) * tw + 8, Math.floor(i / cols) * th + 20);
    }
    fs.writeFileSync(path.join(outDir, name), out.toBuffer('image/png'));
  };
  sheet('walk_cycle.png', CASES[0].shots, 5, 0.35, 1.9, 6, 18);
  sheet('walk_stop.png', CASES[0].shots, 5, 3.0, 4.2, 6, 12);
  sheet('run_cycle.png', CASES[3].shots, 4, 0.35, 1.5, 6, 18);
  sheet('carry_walk.png', CASES[9].shots, 5, 0.2, 2.8, 6, 12);
  sheet('gap_walk.png', CASES[7].shots, 6, 2.0, 3.6, 6, 12);
}
console.log(failed ? `\n${failed} gait check(s) failed.` : '\nAll gait checks passed.');
process.exit(failed ? 1 : 0);
