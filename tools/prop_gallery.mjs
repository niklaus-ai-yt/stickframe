// Prop gallery: draws the story props large in one look, with their options, for checking by eye.
// Usage: node tools/prop_gallery.mjs <out.png> [--look chalk] [--light night] [--cols 8] [--cell 320]
import fs from 'node:fs';
import { drawProp, PROPS, propBox } from '../engine/props.js';
import { palette } from '../engine/looks.js';
import { setupFonts, createCanvas } from '../server/canvas.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
setupFonts();
const LIST = [
  ['dog'], ['dog', { legs: 3 }], ['dog', { fluffy: true }], ['tripod'], ['tripod', { sit: true }], ['tripod', { sleep: true }], ['dog', { legs: 3, hiddenLeg: true }], ['dog', { sit: true }],
  ['hand', { tool: 'pencil' }], ['hand', { tool: 'pen', tremble: 1 }], ['hand', { tool: 'chalk', bandage: true }], ['hand', { tool: 'none', pose: 'palm' }], ['hand', { tool: 'none', pose: 'point' }], ['hand', { tool: 'none', thin: true }],
  ['sandwich'], ['sandwich', { steam: true }], ['sandwich', { wrapped: true }], ['notebook', { doodle: 'sandwich' }], ['notebook', { sag: 1, wet: true }], ['page', { glow: 1 }], ['page', { wet: true }], ['stickman'], ['wrongfigure'],
  ['pencil'], ['pen'], ['chalk'], ['eraser'], ['shavings'], ['umbrella'], ['umbrella', { lopsided: true }], ['umbrella', { open: 0.15 }],
  ['pancakes', { count: 3 }], ['catpancake'], ['catpancake', { bites: 1 }], ['cereal'], ['plate'], ['plates', { count: 8 }],
  ['bike'], ['bike', { oval: true, roll: 20 }], ['chair'], ['flatchair'], ['flatchair', { fold: 0.8 }], ['armchair'],
  ['door'], ['door', { open: 0.6, behind: 'masthill', behindSize: 0.3 }], ['door', { open: 1, behind: 'masthill', behindSize: 0.3 }], ['masthill'], ['mast'],
  ['boardwalk'], ['railing'], ['barrier'], ['crowd', { count: 12, w: 300 }], ['crowd', { count: 12, w: 300, cheer: 1, turn: 1 }], ['banner', { text: 'SUMMER FAIR' }], ['waves'],
  ['gull'], ['swallow'], ['heron'], ['gull', { flat: 1 }], ['swallow', { flat: 1 }], ['heron', { flat: 1 }], ['flock', { count: 80, flat: 1 }], ['flock', { count: 80, rise: 1 }],
  ['footbridge', { gap: 0.52, split: 0.6, crack: 1 }], ['footbridge', { gap: 0.52, beam: true }], ['creek', { level: 0.6 }], ['donotcross'], ['prints', { kind: 'boot' }], ['prints', { kind: 'paw3' }],
  ['stencil'], ['cavewall'], ['phonestream', { viewers: '12.3K', views: '4,000,000', label: 'VIEWS', followers: '40K', text: 'LIVE FROM THE FAIR', money: true }], ['tv', { text: 'THE EVENING NEWS' }], ['phone', { lit: true }], ['bigscreen', { footage: true }], ['bracket', { text: 'FINAL: SATURDAY' }],
  ['trophy'], ['cheque'], ['banknote'], ['wallet', { empty: true }], ['contract', { text: 'RULES' }], ['contract', { unroll: 0.2 }], ['bill', { text: 'BILL\n1 COFFEE' }], ['nametag'],
  ['pen3d', { grow: 0.7 }], ['whiteboard', { text: 'E = mc²' }], ['balance'], ['balance', { tilt: 0.6, left: 'sandwich', rightText: '10 SEC' }], ['scales', { on: 'sandwich' }], ['perspective'], ['depthbox', { depth: 0 }], ['depthbox', { depth: 1 }], ['burst'],
  ['rope'], ['ladder'], ['boat'], ['pony'], ['coathook'], ['coathook', { coat: false, leash: true }], ['flashlight'], ['panel', { text: 'PAPER' }], ['sandpatch'], ['map'], ['fridge', { open: 1 }],
];
const out = args[0] || 'prop_gallery.png', C = +opt('cols', 8), W = +opt('cell', 320), H = Math.round(W * 0.8), rows = Math.ceil(LIST.length / C);
const c = createCanvas(C * W, rows * H), g = c.getContext('2d');
const P = palette(opt('look', 'chalk'), opt('light', 'night'));
g.fillStyle = P.skyTop; g.fillRect(0, 0, c.width, c.height);
LIST.forEach(([type, o = {}], i) => {
  const x = (i % C) * W, y = Math.floor(i / C) * H, b = propBox(type), s = Math.min((W * 0.86) / b.w, (H * 0.72) / b.h);
  g.save(); g.beginPath(); g.rect(x, y, W, H); g.clip();
  drawProp(g, type, x + W / 2, PROPS[type].ground ? y + H * 0.92 : y + H * 0.52, s, P, 0.3, o);
  g.restore();
  const label = type + (Object.keys(o).length ? ' ' + Object.keys(o).filter((k) => k !== 'text').join(',') : '');
  g.font = '700 15px Rubik, sans-serif'; g.fillStyle = '#ffe28a'; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(label.slice(0, 40), x + 6, y + 5);
  g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 1; g.strokeRect(x, y, W, H);
});
fs.writeFileSync(out, c.toBuffer('image/png'));
console.log(out, LIST.length, 'props');
