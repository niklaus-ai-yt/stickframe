// Render a contact sheet (one still per shot) for a storyboard JSON file.
// Usage: node tools/sheet.mjs <storyboard.json> <out.png> [--aspect 9:16] [--look paper] [--words words.json]
import fs from 'node:fs';
import { compileFilm, renderFrame, validateStoryboard } from '../engine/index.js';
import { setupFonts, createCanvas, env } from '../server/canvas.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [file, outFile] = args;
setupFonts();
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const words = opt('--words') ? JSON.parse(fs.readFileSync(opt('--words'), 'utf8')) : raw.words || [];
const aspect = opt('--aspect', '16:9');
const { story, warnings } = validateStoryboard(raw.storyboard || raw, { duration: raw.duration });
if (warnings.length) console.log('warnings:', warnings);
const film = compileFilm(story, { aspect, words, look: opt('--look', raw.look || 'ember'), captions: args.includes('--captions'), duration: raw.duration });
const at = opt('--at', 'mid');
const tw = aspect === '9:16' ? 270 : 480, th = aspect === '9:16' ? 480 : 270;
const cols = aspect === '9:16' ? 6 : 4;
const times = at === 'mid' ? film.shots.map((s) => s.start + (s.end - s.start) * 0.7) : at.split(',').map(Number);
const rows = Math.ceil(times.length / cols);
const sheet = createCanvas(cols * tw, rows * (th + 24));
const sg = sheet.getContext('2d');
sg.fillStyle = '#111'; sg.fillRect(0, 0, sheet.width, sheet.height);
const frame = createCanvas(tw * 2, th * 2);
const fg = frame.getContext('2d');
const t0 = Date.now();
times.forEach((t, i) => {
  renderFrame(fg, film, t, { env, width: frame.width, height: frame.height, endFade: false });
  const x = (i % cols) * tw, y = Math.floor(i / cols) * (th + 24);
  sg.drawImage(frame, x, y + 24, tw, th);
  sg.fillStyle = '#ddd'; sg.font = '14px Rubik';
  const s = film.shots.find((q) => t >= q.start && t < q.end) || film.shots[film.shots.length - 1];
  sg.fillText(`${s.id} ${t.toFixed(1)}s ${s.set}/${s.camera.shot}`, x + 6, y + 17);
});
console.log('frames', times.length, 'ms/frame', ((Date.now() - t0) / times.length).toFixed(1));
fs.writeFileSync(outFile, await sheet.encode('png'));
