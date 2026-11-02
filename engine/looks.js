// Visual "looks". A look decides every colour on screen: figures, sets, props,
// graphics and the final grade. Scenes only ever ask for palette roles, so a
// whole video can switch look instantly.
import { mix, shade } from './util.js';

const L = (skyTop, skyBot, amb, key, ground) => ({ skyTop, skyBot, amb, key, ground });

export const LOOKS = {
  ember: {
    id: 'ember',
    name: 'Ember',
    blurb: 'Warm cinematic evening light. Ink figures with a glowing amber edge.',
    swatch: ['#2a1d30', '#f39a5b', '#ffd59a'],
    figure: { ink: '#15111a', far: '#2c2434', face: '#fff3e2', head: 'solid', rim: '#ffd9a0', glow: '#ffb36b', wobble: 0 },
    lights: {
      day: L('#7fb6d9', '#f3d9b0', '#6b5a6e', '#ffd59a', '#4a3f48'),
      sunset: L('#3b2a55', '#f39a5b', '#4e3a52', '#ffb36b', '#2e2433'),
      night: L('#0c1028', '#2a2350', '#2a2a46', '#ffc777', '#191a2b'),
      indoor: L('#3b2a55', '#f0a060', '#5a4250', '#ffc27a', '#3a2c35'),
      cool: L('#9cc6e0', '#dfeef5', '#4c5b6b', '#d8f1ff', '#323d4a'),
      dark: L('#07070d', '#1a1222', '#1f1923', '#ff8a5c', '#100c12'),
      void: L('#1b1428', '#3a2440', '#2a2036', '#ffcf8a', '#1b1424'),
    },
    ui: { text: '#fff4e2', gold: '#ffc94a', hot: '#ff6b4a', cool: '#6fd3ff', panel: 'rgba(22,15,26,0.78)', panelText: '#fff4e2', shadow: 'rgba(0,0,0,0.55)' },
    grade: { tint: '#ff9a4a', tintA: 0.05, vignette: 0.5, grain: 0.035 },
  },
  moonlight: {
    id: 'moonlight',
    name: 'Moonlight',
    blurb: 'Cool blue nights and silver edges. Moody and mysterious.',
    swatch: ['#0b1430', '#3d6bb3', '#bfe2ff'],
    figure: { ink: '#0a0d16', far: '#1d2439', face: '#eaf4ff', head: 'solid', rim: '#bfe2ff', glow: '#6fb4ff', wobble: 0 },
    lights: {
      day: L('#6d9ccc', '#cfe3ee', '#4d5a70', '#e8f3ff', '#2f3848'),
      sunset: L('#26305e', '#d97d6c', '#3a3d5c', '#ffb08a', '#22253a'),
      night: L('#050a1c', '#16264a', '#1c2542', '#a9d4ff', '#0e1428'),
      indoor: L('#0d1834', '#2d4370', '#2c3555', '#ffd08a', '#1a2038'),
      cool: L('#2a4466', '#7fa8c8', '#304058', '#bfe6ff', '#1c2638'),
      dark: L('#020409', '#0d1424', '#121a2c', '#6fb4ff', '#070b14'),
      void: L('#0a1226', '#1d2b4d', '#18213b', '#9fd0ff', '#0b1122'),
    },
    ui: { text: '#eaf4ff', gold: '#ffd36b', hot: '#ff6a7a', cool: '#7fe0ff', panel: 'rgba(8,14,30,0.8)', panelText: '#eaf4ff', shadow: 'rgba(0,0,0,0.6)' },
    grade: { tint: '#3a6cff', tintA: 0.05, vignette: 0.55, grain: 0.04 },
  },
  paper: {
    id: 'paper',
    name: 'Sketchbook',
    blurb: 'Hand-drawn ink on warm paper. Friendly, classic, readable.',
    swatch: ['#f4ecdc', '#1b1b1f', '#d9822b'],
    figure: { ink: '#1b1b1f', far: '#44444c', face: '#1b1b1f', head: 'outline', headFill: '#f8f1e3', rim: null, glow: null, wobble: 0.7 },
    outline: '#2a2622',
    propShade: [-0.12, -0.26, 0.22],
    lights: {
      day: L('#cfe3ef', '#f4ecdc', '#ece0c8', '#fff6d6', '#dccdae'),
      sunset: L('#f2c9a8', '#f6e6cf', '#ecd6bd', '#ffd9a8', '#dcc4a4'),
      night: L('#9aa6c4', '#d2d4e0', '#cfcbd8', '#fff1c4', '#b9b3c6'),
      indoor: L('#e6d3b6', '#f3e7d2', '#eddfc7', '#ffeec8', '#dac8a8'),
      cool: L('#d3e3ea', '#eef2ec', '#e2e6df', '#f4fbff', '#cad3cd'),
      dark: L('#9a95a0', '#c4bdbf', '#bdb6b8', '#f0e0c0', '#a39b9e'),
      void: L('#efe6d4', '#f6efe2', '#f1e8d6', '#fff8e6', '#e4d8bf'),
    },
    ui: { text: '#1b1b1f', gold: '#d9822b', hot: '#d6402f', cool: '#2f6fb0', panel: 'rgba(255,251,242,0.94)', panelText: '#1b1b1f', shadow: 'rgba(255,250,238,0.95)' },
    grade: { tint: '#c89a5a', tintA: 0.035, vignette: 0.22, grain: 0.06 },
  },
  chalk: {
    id: 'chalk',
    name: 'Chalkboard',
    display: '"Anton", "Arial Narrow", Impact, sans-serif',
    blurb: 'Chalk lines on a green board. Great for lessons and facts.',
    swatch: ['#1f3a33', '#eef0e6', '#f7d774'],
    figure: { ink: '#eef0e6', far: '#b5c2b8', face: '#eef0e6', head: 'outline', headFill: '#22403a', rim: null, glow: null, wobble: 0.9 },
    outline: '#e6e9dc',
    propShade: [0.07, -0.12, 0.2],
    lights: {
      day: L('#2a4d44', '#2f5449', '#29483f', '#f6f0d0', '#21392f'),
      sunset: L('#3a3f36', '#4a4a38', '#2f463c', '#f7d774', '#25362c'),
      night: L('#15272a', '#1d3537', '#1f3a36', '#e8f0ff', '#14241f'),
      indoor: L('#264639', '#2e5244', '#28473c', '#f7e6b0', '#1f362c'),
      cool: L('#24434a', '#2c5059', '#27454b', '#e8fbff', '#1c3338'),
      dark: L('#111d1b', '#182826', '#172624', '#f2b9a0', '#0e1816'),
      void: L('#1f3a33', '#244339', '#223f37', '#f6f0d0', '#1a3029'),
    },
    ui: { text: '#f3f1e4', gold: '#f7d774', hot: '#ff9a88', cool: '#9fd8ff', panel: 'rgba(20,40,34,0.88)', panelText: '#f3f1e4', shadow: 'rgba(0,0,0,0.35)' },
    grade: { tint: '#ffffff', tintA: 0, vignette: 0.35, grain: 0.07 },
  },
  candy: {
    id: 'candy',
    name: 'Candy Pop',
    blurb: 'Bright flat colours and sticker-outlined figures. Loud and fun.',
    swatch: ['#56c2ff', '#ff4f7b', '#ffd23f'],
    figure: { ink: '#1e1840', far: '#3b3270', face: '#ffffff', head: 'solid', rim: null, glow: null, sticker: '#ffffff', wobble: 0 },
    propShade: [-0.28, -0.45, 0.25],
    lights: {
      day: L('#56c2ff', '#c4f1ff', '#ffc9d6', '#fff4b8', '#8a6fd1'),
      sunset: L('#ff7aa8', '#ffd27a', '#ffb39a', '#fff0a8', '#7a4fb8'),
      night: L('#2b1d6b', '#6a3fb5', '#5a43a8', '#ffe36b', '#24185a'),
      indoor: L('#ffd36b', '#ffefb0', '#ffcf9f', '#fff3c2', '#e07a5f'),
      cool: L('#7fe3d6', '#d8fff8', '#a8e6e0', '#ffffff', '#4aa6b5'),
      dark: L('#1a1240', '#3a1f6b', '#2e2160', '#ff5ea8', '#120c2e'),
      void: L('#ff8fb8', '#ffd08a', '#ffb0c4', '#fff6cc', '#e0709a'),
    },
    ui: { text: '#ffffff', gold: '#ffd23f', hot: '#ff4f7b', cool: '#3fd0ff', panel: 'rgba(30,24,64,0.86)', panelText: '#ffffff', shadow: 'rgba(30,24,64,0.45)' },
    grade: { tint: '#ffffff', tintA: 0, vignette: 0.14, grain: 0 },
  },
};

export const LOOK_IDS = Object.keys(LOOKS);
export const LIGHTS = ['day', 'sunset', 'night', 'indoor', 'cool', 'dark', 'void'];

export function getLook(id) {
  return LOOKS[id] || LOOKS.ember;
}

const palCache = new Map();
// Expand a look + lighting into every colour role a scene may need.
export function palette(lookId, light) {
  const key = lookId + '|' + light;
  if (palCache.has(key)) return palCache.get(key);
  const look = getLook(lookId);
  const l = look.lights[light] || look.lights.day;
  const [pMain, pDark, pLight] = look.propShade || [-0.42, -0.6, 0.16];
  const night = light === 'night' || light === 'dark';
  const P = {
    light,
    night,
    skyTop: l.skyTop,
    skyBot: l.skyBot,
    amb: l.amb,
    key: l.key,
    wall: l.amb,
    wallDark: shade(l.amb, -0.3),
    wallLight: shade(l.amb, 0.12),
    floor: mix(l.ground, l.amb, 0.2),
    floorDark: shade(mix(l.ground, l.amb, 0.2), -0.32),
    ground: l.ground,
    prop: shade(l.amb, pMain),
    propDark: shade(l.amb, pDark),
    propLight: shade(l.amb, pLight),
    wood: mix(shade(l.amb, pMain), '#8a5a3a', 0.35),
    woodDark: mix(shade(l.amb, pDark), '#5a3520', 0.3),
    metal: mix(shade(l.amb, pMain), '#9fb0c2', 0.35),
    fabric: mix(shade(l.amb, pMain), '#6a5aa0', 0.25),
    grass: mix(l.ground, '#3f7a45', look.id === 'chalk' ? 0.15 : 0.5),
    grassDark: shade(mix(l.ground, '#3f7a45', 0.5), -0.3),
    leaf: mix(shade(l.amb, pMain), '#3f8a4f', look.id === 'chalk' ? 0.2 : 0.55),
    water: mix(l.skyTop, '#2a6a9a', 0.45),
    sand: mix(l.ground, '#d9b97a', look.id === 'chalk' ? 0.15 : 0.55),
    rock: mix(l.ground, '#7a7480', 0.35),
    screen: mix(l.key, '#9fe0ff', 0.6),
    sun: l.key,
    windowLit: night ? mix(l.key, '#ffd27a', 0.5) : l.key,
    outline: look.outline || null,
    ui: look.ui,
    look,
  };
  palCache.set(key, P);
  return P;
}
