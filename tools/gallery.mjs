// Developer gallery: renders every pose, mood, set or look as a contact sheet.
// Usage: node tools/gallery.mjs poses|moods|sets|looks <out.png> [--look ember] [--aspect 16:9]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { catalog } from '../engine/index.js';

const [kind, out, ...rest] = process.argv.slice(2);
const C = catalog();
const shots = [];
let t = 0;
const add = (s) => { shots.push({ id: `${s.id}`, start: t, end: t + 2, ...s }); t += 2; };
if (kind === 'poses') C.poses.forEach((p, i) => add({ id: p, set: 'void', camera: { shot: 'medium', on: 'a', move: 'static' }, actors: [{ id: 'a', x: 0.5, pose: p, mood: 'happy', face: 'right', hold: p === 'hold' || p === 'phone' ? 'phone' : undefined }], text: [{ type: 'label', text: p, x: 0.5, y: 0.12 }] }));
if (kind === 'moods') C.moods.forEach((m) => add({ id: m, set: 'void', camera: { shot: 'face', on: 'a', move: 'static' }, actors: [{ id: 'a', x: 0.5, pose: 'stand', mood: m, face: 'right' }], text: [{ type: 'label', text: m, x: 0.5, y: 0.1 }] }));
if (kind === 'sets') Object.keys(C.sets).forEach((s) => add({ id: s, set: s, camera: { shot: 'wide', move: 'static' }, actors: [{ id: 'a', x: 0.35, pose: 'stand', mood: 'happy' }, { id: 'b', x: 0.62, pose: 'wave', mood: 'happy' }] }));
if (kind === 'wear') C.wear.forEach((w) => add({ id: w, set: 'void', camera: { shot: 'close', on: 'a', move: 'static' }, actors: [{ id: 'a', x: 0.5, pose: 'stand', mood: 'happy', face: 'right' }], text: [{ type: 'label', text: w, x: 0.5, y: 0.1 }], _wear: w }));
const cast = kind === 'wear' ? [] : [{ id: 'a', name: 'A', color: '#ff5a3c', wear: ['scarf'] }, { id: 'b', name: 'B', color: '#3fb0ff', wear: ['cap'] }];
if (kind === 'wear') shots.forEach((s, i) => { s.actors[0].id = 'a' + i; s.camera.on = 'a' + i; cast.push({ id: 'a' + i, color: '#ff5a3c', wear: [s._wear] }); });
const tmp = path.join(os.tmpdir(), `sf-gallery-${kind}.json`);
fs.writeFileSync(tmp, JSON.stringify({ duration: t, storyboard: { cast, shots } }));
execFileSync(process.execPath, ['tools/sheet.mjs', tmp, out, ...rest], { stdio: 'inherit' });
