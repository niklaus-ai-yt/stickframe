// Locations. Each set paints a full background (wider than the frame so camera
// moves never reveal an edge) using only palette colours, and reports where its
// key light is so figures get the correct rim.
import { TAU, clamp, lerp, css, mix, shade, glow, roundRect, circle, ellipse, rng, noise1 } from './util.js';
import { drawProp as drawPropAlways } from './props.js';

// Set dressing hidden for the current shot (shot "hide": prop types such as "bench", plus "sun", "moon", "disc", "stars").
let HIDE = null;
export const setHide = (s) => { HIDE = s; };
const drawProp = (g, type, ...rest) => (HIDE?.has(type) ? false : drawPropAlways(g, type, ...rest));

const sky = (g, S, y0 = -S.H, y1 = S.GY) => {
  const { P, W } = S;
  const gr = g.createLinearGradient(0, Math.max(-S.H, y0), 0, y1);
  gr.addColorStop(0, css(P.skyTop));
  gr.addColorStop(1, css(P.skyBot));
  g.fillStyle = gr;
  g.fillRect(-W, -S.H, W * 3, S.H * 3);
};

function stars(g, S, n = 120, y1 = S.GY * 0.75) {
  if (HIDE?.has('stars')) return;
  if (!S.P.night && S.P.light !== 'void') return;
  const r = rng(77);
  for (let i = 0; i < n; i++) {
    const x = -S.W + r() * S.W * 3, y = -S.H * 0.3 + r() * (y1 + S.H * 0.3);
    const tw = 0.5 + 0.5 * Math.sin(S.t * (1 + r() * 2) + i);
    g.fillStyle = css('#ffffff', 0.25 + tw * 0.55 * r());
    g.fillRect(x, y, 2 + r() * 2, 2 + r() * 2);
  }
}

function sunOrMoon(g, S, x, y, r = 70) {
  const { P } = S;
  if (HIDE && (HIDE.has('disc') || HIDE.has(P.light === 'night' || P.light === 'dark' ? 'moon' : 'sun'))) return;
  if (P.light === 'night' || P.light === 'dark') {
    if (!P.outline) glow(g, x, y, r * 4, '#cfe0ff', 0.25);
    g.fillStyle = css('#eef2ff'); circle(g, x, y, r * 0.7); g.fill();
  } else if (P.light === 'day' || P.light === 'sunset' || P.light === 'cool') {
    if (!P.outline) glow(g, x, y, r * 5, P.sun, 0.5);
    g.fillStyle = css(mix(P.sun, '#ffffff', 0.4)); circle(g, x, y, r); g.fill();
    if (P.outline) { g.strokeStyle = P.outline; g.lineWidth = 3; g.stroke(); }
  }
}

function hills(g, S, y, amp, color, seed, freq = 0.004) {
  g.fillStyle = css(color);
  g.beginPath();
  g.moveTo(-S.W, S.H * 2);
  for (let x = -S.W; x <= S.W * 2; x += 30) {
    const k = Math.sin(x * freq + seed) * 0.6 + Math.sin(x * freq * 2.3 + seed * 3) * 0.4;
    g.lineTo(x, y - k * amp);
  }
  g.lineTo(S.W * 2, S.H * 2);
  g.closePath();
  g.fill();
  if (S.P.outline) { g.strokeStyle = S.P.outline; g.lineWidth = 3; g.stroke(); }
}

function ground(g, S, color, y = S.GY - 30, lines = false) {
  const { W, H, P } = S;
  const gr = g.createLinearGradient(0, y, 0, H * 1.2);
  gr.addColorStop(0, css(color));
  gr.addColorStop(1, css(shade(color, -0.35)));
  g.fillStyle = gr;
  g.fillRect(-W, y, W * 3, H * 2);
  if (P.outline) { g.strokeStyle = P.outline; g.lineWidth = 3; g.beginPath(); g.moveTo(-W, y); g.lineTo(W * 2, y); g.stroke(); }
  if (lines) {
    g.strokeStyle = css(shade(color, -0.25), 0.6);
    g.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      const yy = y + Math.pow(i / 8, 1.6) * (H - y + 60);
      g.beginPath(); g.moveTo(-W, yy); g.lineTo(W * 2, yy); g.stroke();
    }
  }
}

function skyline(g, S, base, color, seed, hMin, hMax, lit = 0.25) {
  const r = rng(seed);
  const { W, P } = S;
  for (let x = -W; x < W * 2;) {
    const w = 60 + r() * 120, h = hMin + r() * (hMax - hMin);
    g.fillStyle = css(color);
    g.fillRect(x, base - h, w, h + 400);
    if (P.outline) { g.strokeStyle = P.outline; g.lineWidth = 2; g.strokeRect(x, base - h, w, h + 400); }
    if (lit > 0) {
      for (let yy = base - h + 16; yy < base - 20; yy += 26) {
        for (let xx = x + 10; xx < x + w - 14; xx += 22) {
          if (r() < lit) { g.fillStyle = css(P.windowLit, P.night ? 0.85 : 0.35); g.fillRect(xx, yy, 10, 14); }
        }
      }
    }
    x += w + 6 + r() * 30;
  }
}

function lightPool(g, S, x, y, rx, color, a = 0.35) {
  if (S.P.outline) return;
  g.save();
  g.translate(x, y);
  g.scale(1, 0.18);
  glow(g, 0, 0, rx, color, a);
  g.restore();
}

function particlesDust(g, S, n = 40) {
  const r = rng(11);
  g.fillStyle = css(S.P.key, 0.5);
  for (let i = 0; i < n; i++) {
    const x = (r() * S.W * 1.4 - S.W * 0.2 + S.t * (8 + r() * 10)) % (S.W * 1.4) - S.W * 0.2;
    const y = S.H * 0.1 + r() * S.H * 0.7 + Math.sin(S.t * 0.7 + i) * 12;
    g.globalAlpha = 0.2 + 0.4 * r();
    circle(g, x, y, 1.5 + r() * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

// ---------- interiors ----------
function room(g, S, opt = {}) {
  const { W, H, GY, P } = S;
  const back = GY - (S.vertical ? 120 : 80);
  S.layer(0.5, () => {
    const wall = opt.wall || P.wall;
    const gr = g.createLinearGradient(0, -H, 0, back);
    gr.addColorStop(0, css(shade(wall, -0.25)));
    gr.addColorStop(1, css(wall));
    g.fillStyle = gr;
    g.fillRect(-W, -H, W * 3, back + H * 2);
    if (opt.stripes) {
      g.fillStyle = css(shade(wall, -0.06));
      for (let x = -W; x < W * 2; x += 80) g.fillRect(x, -H, 40, back + H);
    }
    if (opt.window !== false) {
      const wx = opt.windowX ?? W * 0.72, ww = opt.windowW ?? (S.vertical ? 420 : 380), wh = opt.windowH ?? (S.vertical ? 520 : 360);
      const wy = back - wh - (S.vertical ? 260 : 130);
      g.save();
      roundRect(g, wx - ww / 2, wy, ww, wh, 6);
      g.clip();
      const sg = g.createLinearGradient(0, wy, 0, wy + wh);
      sg.addColorStop(0, css(P.skyTop)); sg.addColorStop(1, css(P.skyBot));
      g.fillStyle = sg; g.fillRect(wx - ww / 2, wy, ww, wh);
      if (P.night) { stars(g, S, 60); g.fillStyle = css('#eef2ff'); circle(g, wx + ww * 0.25, wy + wh * 0.25, 22); g.fill(); }
      else if (P.light !== 'dark') { if (!P.outline) glow(g, wx - ww * 0.2, wy + wh * 0.8, ww * 0.7, P.sun, 0.6); }
      skyline(g, { ...S }, wy + wh, shade(P.skyTop, P.night ? -0.2 : -0.1), 5, 40, 160, P.night ? 0.3 : 0);
      if (opt.blinds) { g.fillStyle = css(shade(wall, -0.2), 0.75); for (let y = wy; y < wy + wh; y += 22) g.fillRect(wx - ww / 2, y, ww, 9); }
      g.restore();
      g.strokeStyle = css(P.outline || shade(wall, -0.45)); g.lineWidth = 14;
      roundRect(g, wx - ww / 2, wy, ww, wh, 6); g.stroke();
      g.lineWidth = 8; g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx, wy + wh); g.moveTo(wx - ww / 2, wy + wh / 2); g.lineTo(wx + ww / 2, wy + wh / 2); g.stroke();
      g.fillStyle = css(shade(wall, -0.4)); g.fillRect(wx - ww / 2 - 20, wy + wh, ww + 40, 14);
      if (!P.outline && !P.night) glow(g, wx, wy + wh / 2, ww * 1.3, P.key, 0.18);
      S.keyPos = { x: wx, y: wy + wh / 2 };
    }
    if (opt.frame) {
      const fx = opt.frameX ?? W * 0.28, fy = back - (S.vertical ? 760 : 420);
      g.fillStyle = css(shade(wall, -0.45)); g.fillRect(fx - 70, fy - 50, 140, 100);
      g.fillStyle = css(mix(P.ui.cool, wall, 0.45)); g.fillRect(fx - 60, fy - 40, 120, 80);
      g.fillStyle = css(mix(P.ui.gold, wall, 0.3)); circle(g, fx + 20, fy - 10, 14); g.fill();
      g.fillStyle = css(mix(P.leaf, wall, 0.3)); g.beginPath(); g.moveTo(fx - 60, fy + 40); g.lineTo(fx - 20, fy); g.lineTo(fx + 20, fy + 40); g.fill();
    }
  });
  S.layer(1, () => {
    const fl = opt.floor || P.floor;
    const gr = g.createLinearGradient(0, back, 0, H);
    gr.addColorStop(0, css(fl));
    gr.addColorStop(1, css(shade(fl, -0.35)));
    g.fillStyle = gr;
    g.fillRect(-W, back, W * 3, H * 2);
    g.fillStyle = css(shade(opt.wall || P.wall, -0.45));
    g.fillRect(-W, back - 14, W * 3, 16);
    if (P.outline) { g.strokeStyle = P.outline; g.lineWidth = 3; g.beginPath(); g.moveTo(-W, back); g.lineTo(W * 2, back); g.stroke(); }
    if (opt.tiles) {
      g.strokeStyle = css(shade(fl, -0.2), 0.5); g.lineWidth = 2;
      for (let i = -20; i < 40; i++) { g.beginPath(); g.moveTo(W / 2 + i * 120 * 0.4, back); g.lineTo(W / 2 + i * 120 * 1.6, H + 200); g.stroke(); }
    }
    if (opt.rug) { g.fillStyle = css(mix(opt.rug, fl, 0.55), 0.6); ellipse(g, W * 0.4, GY + 24, W * 0.2, 26); g.fill(); }
    const kp = S.keyPos || { x: W * 0.7 };
    lightPool(g, S, kp.x - 60, GY + 20, W * 0.45, P.key, 0.15);
  });
  return back;
}

function furniture(g, S, list, back) {
  S.layer(1, () => {
    for (const [type, fx, sz, o] of list) drawProp(g, type, S.W * fx, back + (S.vertical ? 40 : 26), (sz || 1) * S.propScale, S.P, S.t, o || {});
  });
}

function wallItem(g, S, type, fx, fy, sz, o) {
  S.layer(0.5, () => drawProp(g, type, S.W * fx, S.H * fy, sz * S.propScale, S.P, S.t, o || {}));
}

export const SETS = {
  void: {
    light: 'void',
    desc: 'abstract gradient with a soft glowing floor; use for ideas, numbers, inner thoughts',
    draw(g, S) {
      const { W, H, GY, P } = S;
      S.layer(0.2, () => {
        const gr = g.createRadialGradient(W / 2, GY - H * 0.25, 10, W / 2, GY - H * 0.2, Math.max(W, H) * 0.9);
        gr.addColorStop(0, css(shade(P.skyBot, 0.12)));
        gr.addColorStop(1, css(P.skyTop));
        g.fillStyle = gr;
        g.fillRect(-W, -H, W * 3, H * 3);
      });
      S.layer(1, () => {
        if (!P.outline) { g.save(); g.translate(W / 2, GY); g.scale(1, 0.12); glow(g, 0, 0, W * 0.6, P.key, 0.35); g.restore(); }
        g.strokeStyle = css(P.key, 0.25); g.lineWidth = 2;
        g.beginPath(); g.moveTo(-W, GY + 2); g.lineTo(W * 2, GY + 2); g.stroke();
      });
      S.keyPos = { x: W / 2, y: GY - H * 0.5 };
    },
  },
  stage: {
    light: 'dark',
    desc: 'dark theatre stage with curtains and a spotlight; use for reveals, speeches, performances',
    draw(g, S) {
      const { W, H, GY, P } = S;
      S.layer(0.5, () => {
        g.fillStyle = css(shade(P.wall, -0.5)); g.fillRect(-W, -H, W * 3, H * 3);
        const cur = mix(P.ui.hot, '#5a1020', 0.55);
        for (let i = -12; i < 30; i++) { g.fillStyle = css(i % 2 ? cur : shade(cur, -0.2)); g.fillRect(i * 70, -H, 70, GY + H - 40); }
        g.fillStyle = css(shade(P.wall, -0.6), 0.85); g.fillRect(W * 0.18, -H, W * 0.64, GY + H - 40);
      });
      S.layer(1, () => {
        g.fillStyle = css(P.woodDark); g.fillRect(-W, GY - 40, W * 3, H);
        if (!P.outline) {
          g.save(); g.globalCompositeOperation = 'lighter';
          const gr = g.createLinearGradient(W / 2, 0, W / 2, GY);
          gr.addColorStop(0, css(P.key, 0.0)); gr.addColorStop(1, css(P.key, 0.28));
          g.fillStyle = gr; g.beginPath(); g.moveTo(W / 2 - 40, -40); g.lineTo(W / 2 + 40, -40); g.lineTo(W / 2 + 260, GY + 20); g.lineTo(W / 2 - 260, GY + 20); g.fill();
          g.restore();
          lightPool(g, S, W / 2, GY + 6, 360, P.key, 0.6);
        }
      });
      S.keyPos = { x: W / 2, y: -60 };
    },
  },
  blueprint: {
    light: 'void',
    desc: 'technical blueprint grid; use for explanations, diagrams, science and how-it-works beats',
    draw(g, S) {
      const { W, H, P } = S;
      const paper = !!P.outline && P.look.id === 'paper';
      const bg = paper ? '#eef3f4' : P.look.id === 'chalk' ? shade(P.skyTop, -0.1) : mix('#0f2a4a', P.skyTop, 0.25);
      const ln = paper ? '#9cc4dc' : P.look.id === 'chalk' ? P.outline : '#6fb6ff';
      S.layer(0.4, () => {
        g.fillStyle = css(bg); g.fillRect(-W, -H, W * 3, H * 3);
        for (let x = -W; x < W * 2; x += 40) { g.fillStyle = css(ln, x % 200 === 0 ? 0.35 : 0.12); g.fillRect(x, -H, x % 200 === 0 ? 2 : 1, H * 3); }
        for (let y = -H; y < H * 2; y += 40) { g.fillStyle = css(ln, y % 200 === 0 ? 0.35 : 0.12); g.fillRect(-W, y, W * 3, y % 200 === 0 ? 2 : 1); }
      });
      S.keyPos = { x: W * 0.3, y: 0 };
      S.diagram = true;
    },
  },
  room: { light: 'indoor', desc: 'plain room with a window', draw(g, S) { room(g, S, { frame: true }); } },
  bedroom: {
    light: 'indoor', desc: 'bedroom: bed, lamp, window, poster',
    draw(g, S) { const b = room(g, S, { frame: true, frameX: 0.3, rug: S.P.ui.hot }); furniture(g, S, [['bed', 0.22, 1.1], ['lamp', 0.42, 0.8]], b); },
  },
  livingroom: {
    light: 'indoor', desc: 'living room: couch, TV, plant',
    draw(g, S) { const b = room(g, S, { windowX: S.W * 0.82, stripes: true }); wallItem(g, S, 'tv', 0.42, S.vertical ? 0.4 : 0.36, 1); furniture(g, S, [['couch', 0.2, 1], ['plant', 0.62, 1], ['lamp', 0.05, 0.9]], b); },
  },
  office: {
    light: 'cool', desc: 'office: desks with monitors, blinds',
    draw(g, S) { const b = room(g, S, { blinds: true, windowX: S.W * 0.5, windowW: S.vertical ? 600 : 900 }); furniture(g, S, [['desk', 0.15, 1], ['monitor', 0.13, 0.9], ['plant', 0.32, 0.8], ['desk', 0.85, 1], ['monitor', 0.87, 0.9]], b); },
  },
  kitchen: {
    light: 'indoor', desc: 'kitchen: counter, fridge, window',
    draw(g, S) { const b = room(g, S, { windowX: S.W * 0.5, tiles: true }); furniture(g, S, [['counter', 0.42, 1.2], ['fridge', 0.85, 1.05]], b); },
  },
  classroom: {
    light: 'day', desc: 'classroom: chalkboard, desks',
    draw(g, S) { const b = room(g, S, { windowX: S.W * 0.86, windowW: 260 }); wallItem(g, S, 'board', 0.42, S.vertical ? 0.42 : 0.34, S.vertical ? 1.4 : 1.6, { text: S.boardText || '' }); furniture(g, S, [['desk', 0.12, 0.8], ['desk', 0.72, 0.8]], b); },
  },
  cafe: {
    light: 'sunset', desc: 'cafe: counter, tables, big window, hanging lamps',
    draw(g, S) {
      const b = room(g, S, { windowX: S.W * 0.62, windowW: S.vertical ? 700 : 1000, windowH: S.vertical ? 600 : 400 });
      S.layer(0.6, () => { for (const fx of [0.2, 0.5, 0.8]) { const x = S.W * fx; g.strokeStyle = css(S.P.propDark); g.lineWidth = 3; g.beginPath(); g.moveTo(x, -S.H); g.lineTo(x, S.H * 0.12); g.stroke(); if (!S.P.outline) glow(g, x, S.H * 0.15, 140, S.P.key, 0.5); g.fillStyle = css(S.P.propDark); g.beginPath(); g.moveTo(x - 30, S.H * 0.15); g.lineTo(x + 30, S.H * 0.15); g.lineTo(x + 14, S.H * 0.11); g.lineTo(x - 14, S.H * 0.11); g.fill(); } });
      furniture(g, S, [['counter', 0.12, 1], ['table', 0.55, 0.9], ['stool', 0.47, 0.9], ['table', 0.88, 0.9]], b);
    },
  },
  hospital: {
    light: 'cool', desc: 'hospital room: bed, heart monitor, pale walls',
    draw(g, S) {
      const b = room(g, S, { windowX: S.W * 0.2, tiles: true });
      furniture(g, S, [['bed', 0.6, 1.05]], b);
      S.layer(0.5, () => {
        const x = S.W * 0.86, y = b - (S.vertical ? 520 : 300);
        g.fillStyle = css(S.P.propDark); roundRect(g, x - 80, y - 55, 160, 110, 8); g.fill();
        g.strokeStyle = '#4dff8a'; g.lineWidth = 3; g.beginPath();
        for (let i = 0; i <= 60; i++) { const xx = x - 70 + i * (140 / 60); const ph = (i / 60 * 2 + S.t * 1.2) % 1; const k = ph > 0.45 && ph < 0.55 ? Math.sin((ph - 0.45) / 0.1 * TAU) * 30 : 0; i ? g.lineTo(xx, y - k) : g.moveTo(xx, y - k); }
        g.stroke();
      });
    },
  },
  lab: {
    light: 'cool', desc: 'science lab: benches, glowing flasks, monitors',
    draw(g, S) {
      const b = room(g, S, { window: false, tiles: true });
      S.layer(0.5, () => { for (let i = 0; i < 6; i++) { const x = S.W * (0.1 + i * 0.16), y = b - (S.vertical ? 500 : 280); g.fillStyle = css(S.P.propDark); roundRect(g, x - 60, y - 40, 120, 80, 6); g.fill(); g.fillStyle = css(S.P.screen, 0.7); roundRect(g, x - 52, y - 32, 104, 64, 4); g.fill(); } });
      S.layer(1, () => {
        g.fillStyle = css(S.P.metal); g.fillRect(-S.W, b - 10, S.W * 3, 14);
        for (let i = 0; i < 10; i++) { const x = S.W * (0.05 + i * 0.1), c = [S.P.ui.cool, '#7dff9a', S.P.ui.hot, S.P.ui.gold][i % 4]; g.fillStyle = css(c, 0.8); g.beginPath(); g.moveTo(x - 14, b - 10); g.lineTo(x + 14, b - 10); g.lineTo(x + 5, b - 46); g.lineTo(x - 5, b - 46); g.fill(); if (!S.P.outline) glow(g, x, b - 24, 50, c, 0.35); }
      });
      S.keyPos = { x: S.W / 2, y: -100 };
    },
  },
  gym: {
    light: 'cool', desc: 'gym: weights rack, mats, mirrors',
    draw(g, S) {
      const b = room(g, S, { window: false, wall: mix(S.P.wall, '#556070', 0.2) });
      S.layer(0.5, () => { g.fillStyle = css(S.P.screen, 0.18); g.fillRect(S.W * 0.1, b - (S.vertical ? 700 : 420), S.W * 0.8, S.vertical ? 600 : 380); });
      S.layer(1, () => { for (let i = 0; i < 4; i++) { const x = S.W * (0.15 + i * 0.22); g.fillStyle = css(S.P.propDark); g.fillRect(x - 70, b - 6, 140, 12); circle(g, x - 60, b - 20, 26); g.fill(); circle(g, x + 60, b - 20, 26); g.fill(); g.fillStyle = css(S.P.metal); g.fillRect(x - 64, b - 23, 128, 6); } });
      S.keyPos = { x: S.W / 2, y: -100 };
    },
  },
  hallway: {
    light: 'indoor', desc: 'school hallway with lockers',
    draw(g, S) {
      const b = room(g, S, { window: false });
      S.layer(0.6, () => { const lc = mix(S.P.ui.cool, S.P.wall, 0.45); for (let x = -S.W; x < S.W * 2; x += 90) { g.fillStyle = css(lc); g.fillRect(x, b - (S.vertical ? 520 : 330), 82, S.vertical ? 520 : 330); g.fillStyle = css(shade(lc, -0.25)); for (let k = 0; k < 4; k++) g.fillRect(x + 20, b - (S.vertical ? 480 : 300) + k * 9, 42, 4); g.fillRect(x + 66, b - (S.vertical ? 300 : 180), 6, 26); } });
      S.keyPos = { x: S.W / 2, y: -100 };
    },
  },
  // ---------- exteriors ----------
  street: {
    light: 'night', desc: 'city street: house fronts with lit windows, sidewalk, street lamps, road',
    draw(g, S) {
      const { W, H, GY, P } = S;
      S.layer(0.15, () => { sky(g, S); stars(g, S); sunOrMoon(g, S, W * 0.78, GY * 0.25, 60); });
      S.layer(0.3, () => skyline(g, S, GY - 120, shade(P.skyTop, -0.15), 3, 120, 380, 0.15));
      S.layer(0.6, () => {
        const r = rng(9);
        for (let x = -W; x < W * 2;) {
          const w = 260 + r() * 120, h = 300 + r() * 160;
          const c = mix(P.wall, [P.ui.hot, P.ui.cool, P.ui.gold][Math.floor(r() * 3)], 0.12);
          g.fillStyle = css(shade(c, -0.25)); g.fillRect(x, GY - 90 - h, w, h + 300);
          if (P.outline) { g.strokeStyle = P.outline; g.lineWidth = 3; g.strokeRect(x, GY - 90 - h, w, h); }
          for (let k = 0; k < 2; k++) for (let j = 0; j < Math.floor(w / 110); j++) {
            const wx = x + 30 + j * 110, wy = GY - 90 - h + 40 + k * 140;
            g.fillStyle = css(r() < 0.65 ? P.windowLit : shade(c, -0.5), P.night ? 0.9 : 0.5); g.fillRect(wx, wy, 60, 80);
            if (P.night && !P.outline) glow(g, wx + 30, wy + 40, 90, P.windowLit, 0.15);
          }
          g.fillStyle = css(P.woodDark); g.fillRect(x + w - 90, GY - 230, 60, 140);
          x += w + 20;
        }
      });
      S.layer(1, () => {
        g.fillStyle = css(shade(P.ground, 0.08)); g.fillRect(-W, GY - 90, W * 3, 110);
        g.fillStyle = css(shade(P.ground, -0.2)); g.fillRect(-W, GY + 20, W * 3, H);
        g.fillStyle = css(P.ui.gold, 0.6); for (let x = -W; x < W * 2; x += 160) g.fillRect(x, GY + 130, 80, 8);
        for (const fx of [0.08, 0.6, 1.12]) drawProp(g, 'streetlamp', W * fx, GY - 40, S.propScale * 1.1, P, S.t);
        if (P.night) lightPool(g, S, W * 0.6 + 30, GY - 30, 300, P.windowLit, 0.4);
      });
      S.keyPos = { x: W * 0.62, y: GY - 300 };
    },
  },
  city: {
    light: 'sunset', desc: 'wide city skyline at a distance with a plaza in front',
    draw(g, S) {
      const { W, GY, P } = S;
      S.layer(0.1, () => { sky(g, S); stars(g, S); sunOrMoon(g, S, W * 0.3, GY * 0.4, 80); });
      S.layer(0.25, () => skyline(g, S, GY - 60, shade(P.skyTop, 0.05), 21, 160, 420, 0.1));
      S.layer(0.45, () => skyline(g, S, GY - 40, shade(P.skyTop, -0.25), 22, 220, 600, 0.22));
      S.layer(1, () => { ground(g, S, P.ground, GY - 40, true); });
      S.keyPos = { x: W * 0.3, y: GY * 0.4 };
    },
  },
  rooftop: {
    light: 'night', desc: 'rooftop at night above a glowing city',
    draw(g, S) {
      const { W, GY, P } = S;
      S.layer(0.1, () => { sky(g, S); stars(g, S, 200); sunOrMoon(g, S, W * 0.75, GY * 0.25, 60); });
      S.layer(0.3, () => skyline(g, S, GY + 80, shade(P.skyTop, -0.1), 31, 200, 520, 0.35));
      S.layer(1, () => {
        g.fillStyle = css(shade(P.ground, 0.05)); g.fillRect(-W, GY - 20, W * 3, S.H);
        g.fillStyle = css(shade(P.ground, -0.2)); g.fillRect(-W, GY - 50, W * 3, 30);
        g.fillStyle = css(P.propDark); g.fillRect(W * 0.82, GY - 260, 150, 200); g.fillRect(W * 0.84, GY - 60, 10, 40); g.fillRect(W * 0.94, GY - 60, 10, 40);
      });
      S.keyPos = { x: W * 0.75, y: GY * 0.25 };
    },
  },
  park: {
    light: 'day', desc: 'park: grass, trees, bench, hills, sky',
    draw(g, S) {
      const { W, GY, P } = S;
      S.layer(0.1, () => { sky(g, S); stars(g, S); sunOrMoon(g, S, W * 0.8, GY * 0.22, 70); });
      S.layer(0.25, () => hills(g, S, GY - 160, 60, shade(P.grass, 0.1), 1, 0.003));
      S.layer(0.45, () => { hills(g, S, GY - 90, 40, P.grass, 4, 0.005); for (let i = -3; i < 10; i++) drawProp(g, i % 3 ? 'tree' : 'pine', W * (i * 0.17 + 0.05), GY - 90, S.propScale * 0.8, P, S.t); });
      S.layer(1, () => { ground(g, S, shade(P.grass, -0.1), GY - 40); drawProp(g, 'bench', W * 0.8, GY - 30, S.propScale, P, S.t); drawProp(g, 'bush', W * 0.08, GY - 30, S.propScale, P, S.t); });
      S.keyPos = { x: W * 0.8, y: GY * 0.22 };
    },
  },
  forest: {
    light: 'dark', desc: 'deep forest of pine trees; mysterious or tense',
    draw(g, S) {
      const { W, GY, P } = S;
      S.layer(0.1, () => { sky(g, S); stars(g, S); sunOrMoon(g, S, W * 0.5, GY * 0.2, 50); });
      for (const [d, k, sc] of [[0.3, 0.25, 0.9], [0.5, 0.0, 1.1], [0.7, -0.25, 1.3]]) {
        S.layer(d, () => { const r = rng(Math.floor(d * 100)); for (let x = -W; x < W * 2; x += 90 + r() * 80) drawProp(g, 'pine', x, GY - 60 + (1 - d) * -40, S.propScale * sc * (0.8 + r() * 0.5), { ...P, leaf: shade(P.leaf, k - 0.15), woodDark: shade(P.woodDark, k) }, S.t); });
      }
      S.layer(1, () => ground(g, S, shade(P.grass, -0.35), GY - 40));
      S.keyPos = { x: W * 0.5, y: GY * 0.2 };
    },
  },
  beach: {
    light: 'sunset', desc: 'beach: ocean horizon, sand, setting sun',
    draw(g, S) {
      const { W, H, GY, P } = S;
      const hz = GY - (S.vertical ? 380 : 230);
      S.layer(0.1, () => { sky(g, S, -H, hz); stars(g, S); sunOrMoon(g, S, W * 0.5, hz - 40, 90); });
      S.layer(0.3, () => {
        g.fillStyle = css(P.water); g.fillRect(-W, hz, W * 3, H);
        for (let i = 0; i < 18; i++) { const y = hz + 8 + i * i * 2.2, k = Math.sin(S.t * 1.5 + i) * 30; g.fillStyle = css(P.sun, 0.25 * (1 - i / 18)); g.fillRect(W * 0.5 - 120 + k - i * 6, y, 240 + i * 12, 3); }
      });
      S.layer(1, () => {
        g.fillStyle = css(P.sand); g.beginPath(); g.moveTo(-W, GY - 60); for (let x = -W; x <= W * 2; x += 40) g.lineTo(x, GY - 60 + Math.sin(x * 0.004 + S.t * 0.8) * 10); g.lineTo(W * 2, H * 2); g.lineTo(-W, H * 2); g.fill();
        g.fillStyle = css('#ffffff', 0.4); g.beginPath(); for (let x = -W; x <= W * 2; x += 40) g.lineTo(x, GY - 62 + Math.sin(x * 0.004 + S.t * 0.8) * 10); g.lineTo(W * 2, GY - 52); g.lineTo(-W, GY - 52); g.fill();
      });
      S.keyPos = { x: W * 0.5, y: hz - 40 };
    },
  },
  lake: {
    light: 'sunset', desc: 'lake with a wooden pier/jetty, trees on the far shore',
    draw(g, S) {
      const { W, H, GY, P } = S;
      const hz = GY - (S.vertical ? 360 : 200);
      S.layer(0.1, () => { sky(g, S, -H, hz); stars(g, S); sunOrMoon(g, S, W * 0.7, hz - 120, 60); });
      S.layer(0.3, () => { hills(g, S, hz, 40, shade(P.leaf, -0.4), 2, 0.006); g.fillStyle = css(P.water); g.fillRect(-W, hz, W * 3, H); for (let i = 0; i < 30; i++) { const y = hz + 10 + i * 12, x = ((i * 233 + S.t * 30) % (W * 2)) - W * 0.3; g.fillStyle = css(P.skyBot, 0.25); g.fillRect(x, y, 80 + (i % 4) * 30, 3); } });
      S.layer(1, () => {
        g.fillStyle = css(P.wood); g.fillRect(-W, GY - 20, W * 1.6, 26);
        g.fillStyle = css(P.woodDark); for (let x = -W; x < W * 0.6; x += 120) g.fillRect(x, GY + 6, 14, 200);
        g.fillStyle = css(shade(P.water, -0.2)); g.fillRect(W * 0.6, GY + 10, W * 2, H);
      });
      S.keyPos = { x: W * 0.7, y: hz - 120 };
    },
  },
  pool: {
    light: 'cool', desc: 'swimming pool with lanes, diving platform; sports',
    draw(g, S) {
      const { W, H, GY, P } = S;
      const b = room(g, S, { window: false, wall: mix(P.wall, '#9fc8dc', 0.2) });
      S.layer(1, () => {
        g.fillStyle = css(mix(P.water, '#2fa6d9', 0.4)); g.fillRect(-W, GY + 10, W * 3, H);
        for (let i = 0; i < 6; i++) { g.fillStyle = css(i % 2 ? P.ui.hot : '#ffffff', 0.8); for (let x = -W; x < W * 2; x += 30) { circle(g, x, GY + 40 + i * 50, 6); g.fill(); } }
        for (let i = 0; i < 40; i++) { const x = (i * 97 + S.t * 40) % (W * 1.2), y = GY + 20 + (i * 53) % 300; g.fillStyle = css('#ffffff', 0.18); g.fillRect(x, y, 60, 3); }
        g.fillStyle = css(P.propLight); g.fillRect(-W, GY - 14, W * 3, 24);
      });
      S.keyPos = { x: W / 2, y: -100 };
    },
  },
  mountain: {
    light: 'day', desc: 'mountain range with snow peaks; adventure, scale, challenges',
    draw(g, S) {
      const { W, GY, P } = S;
      S.layer(0.1, () => { sky(g, S); stars(g, S); sunOrMoon(g, S, W * 0.2, GY * 0.25, 70); });
      S.layer(0.25, () => {
        const r = rng(4);
        for (let x = -W; x < W * 2;) { const w = 500 + r() * 400, h = 380 + r() * 300; g.fillStyle = css(shade(P.rock, 0.1)); g.beginPath(); g.moveTo(x, GY - 100); g.lineTo(x + w / 2, GY - 100 - h); g.lineTo(x + w, GY - 100); g.fill(); g.fillStyle = css('#f4f6fb', 0.9); g.beginPath(); g.moveTo(x + w / 2, GY - 100 - h); g.lineTo(x + w / 2 - 70, GY - 100 - h + 110); g.lineTo(x + w / 2 + 70, GY - 100 - h + 110); g.fill(); x += w * 0.6; }
      });
      S.layer(0.5, () => hills(g, S, GY - 70, 50, shade(P.grass, -0.15), 6, 0.004));
      S.layer(1, () => ground(g, S, shade(P.rock, -0.15), GY - 40));
      S.keyPos = { x: W * 0.2, y: GY * 0.25 };
    },
  },
  desert: {
    light: 'day', desc: 'desert dunes and cacti under a hot sun',
    draw(g, S) {
      const { W, GY, P } = S;
      S.layer(0.1, () => { sky(g, S); stars(g, S); sunOrMoon(g, S, W * 0.75, GY * 0.25, 80); });
      S.layer(0.3, () => hills(g, S, GY - 120, 50, shade(P.sand, 0.12), 3, 0.003));
      S.layer(0.6, () => { hills(g, S, GY - 70, 30, P.sand, 8, 0.005); for (const fx of [0.15, 0.7, 1.2]) { const x = W * fx, y = GY - 70; g.strokeStyle = css(mix(P.leaf, '#4a7a3a', 0.5)); g.lineCap = 'round'; g.lineWidth = 30; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 160); g.stroke(); g.lineWidth = 20; g.beginPath(); g.moveTo(x, y - 70); g.lineTo(x - 40, y - 70); g.lineTo(x - 40, y - 120); g.moveTo(x, y - 100); g.lineTo(x + 36, y - 100); g.lineTo(x + 36, y - 140); g.stroke(); } });
      S.layer(1, () => ground(g, S, shade(P.sand, -0.08), GY - 40));
      S.keyPos = { x: W * 0.75, y: GY * 0.25 };
    },
  },
  field: {
    light: 'night', desc: 'sports field/stadium: grass with lines, crowd stands, floodlights',
    draw(g, S) {
      const { W, GY, P } = S;
      S.layer(0.1, () => { sky(g, S); stars(g, S); });
      S.layer(0.35, () => {
        const base = GY - 120;
        for (let row = 0; row < 7; row++) {
          const y = base - row * 46;
          g.fillStyle = css(shade(P.wall, -0.35 - row * 0.03)); g.fillRect(-W, y - 46, W * 3, 46);
          for (let x = -W + (row % 2) * 14; x < W * 2; x += 28) { const k = noise1(Math.floor(x) * 7 + row, 3); const bob = Math.max(0, Math.sin(S.t * 6 + k * 20)) * 6 * (S.crowdCheer ? 1 : 0.2); g.fillStyle = css(k < 0.15 ? P.ui.hot : k < 0.3 ? P.ui.cool : shade(P.wall, -0.6)); circle(g, x, y - 26 - bob, 9); g.fill(); }
        }
        for (const fx of [0.05, 0.95]) { const x = W * fx, y = base - 520; g.fillStyle = css(P.propDark); g.fillRect(x - 6, y, 12, 260); g.fillStyle = css('#ffffff'); g.fillRect(x - 60, y - 40, 120, 50); if (!P.outline) glow(g, x, y - 15, 360, '#ffffff', 0.45); }
      });
      S.layer(1, () => {
        ground(g, S, mix(P.grass, '#2f7a3a', 0.3), GY - 110);
        g.strokeStyle = css('#ffffff', 0.55); g.lineWidth = 4;
        g.beginPath(); g.moveTo(-W, GY + 60); g.lineTo(W * 2, GY + 60); g.moveTo(W / 2, GY - 110); g.lineTo(W / 2, S.H * 2); g.stroke();
      });
      S.keyPos = { x: W * 0.95, y: GY - 600 };
    },
  },
  road: {
    light: 'night', desc: 'open highway at evening or night with moving lane lines; travel, speed',
    draw(g, S) {
      const { W, H, GY, P } = S;
      const hz = GY - (S.vertical ? 420 : 260);
      S.layer(0.1, () => { sky(g, S, -H, hz); stars(g, S); sunOrMoon(g, S, W * 0.5, hz - 60, 70); });
      S.layer(0.3, () => hills(g, S, hz, 50, shade(P.ground, -0.1), 5, 0.004));
      S.layer(1, () => {
        g.fillStyle = css(shade(P.ground, -0.15)); g.fillRect(-W, hz, W * 3, H);
        g.fillStyle = css(mix(P.ground, '#2a2a30', 0.6)); g.beginPath(); g.moveTo(W / 2 - 20, hz); g.lineTo(W / 2 + 20, hz); g.lineTo(W * 1.6, H * 1.2); g.lineTo(-W * 0.6, H * 1.2); g.fill();
        g.fillStyle = css(P.ui.gold, 0.85);
        for (let i = 0; i < 12; i++) { const k = ((i / 12) + S.t * 0.6) % 1, y = hz + Math.pow(k, 2) * (H - hz + 200), w = 2 + k * 14, h = 4 + k * 60; g.fillRect(W / 2 - w / 2, y, w, h); }
      });
      S.keyPos = { x: W * 0.5, y: hz - 60 };
    },
  },
  space: {
    light: 'night', desc: 'outer space: stars, nebula, a planet; huge scale, cosmic ideas',
    draw(g, S) {
      const { W, H, GY, P } = S;
      S.layer(0.05, () => {
        g.fillStyle = css(shade(P.skyTop, -0.5)); g.fillRect(-W, -H, W * 3, H * 3);
        if (!P.outline) { glow(g, W * 0.3, H * 0.3, W * 0.6, P.ui.cool, 0.18); glow(g, W * 0.75, H * 0.6, W * 0.5, P.ui.hot, 0.14); }
        const r = rng(5); for (let i = 0; i < 260; i++) { g.fillStyle = css('#ffffff', 0.3 + r() * 0.7); const s = r() < 0.1 ? 3 : 1.6; g.fillRect(-W + r() * W * 3, -H + r() * H * 3, s, s); }
      });
      S.layer(0.2, () => { const x = W * 0.78, y = H * 0.32, rr = Math.min(W, H) * 0.22; g.fillStyle = css(mix(P.ui.hot, '#c86a3a', 0.5)); circle(g, x, y, rr); g.fill(); g.save(); circle(g, x, y, rr); g.clip(); g.fillStyle = css('#000', 0.35); circle(g, x + rr * 0.4, y + rr * 0.3, rr); g.fill(); g.restore(); g.strokeStyle = css(P.ui.gold, 0.6); g.lineWidth = 6; ellipse(g, x, y, rr * 1.6, rr * 0.3, -0.3); g.stroke(); });
      S.layer(1, () => { if (!S.noGround) { g.fillStyle = css(mix(P.rock, '#9a9aa8', 0.3)); g.beginPath(); g.moveTo(-W, GY - 30); for (let x = -W; x <= W * 2; x += 60) g.lineTo(x, GY - 30 + Math.sin(x * 0.01) * 12); g.lineTo(W * 2, H * 2); g.lineTo(-W, H * 2); g.fill(); for (let i = 0; i < 8; i++) { g.fillStyle = css(shade(P.rock, -0.3)); ellipse(g, W * (i * 0.17 - 0.1), GY + 40 + (i % 3) * 50, 60, 14); g.fill(); } } });
      S.keyPos = { x: W * 0.78, y: H * 0.32 };
    },
  },
  sky: {
    light: 'day', desc: 'open sky with clouds; flying, falling, dreaming, no ground',
    draw(g, S) {
      const { W, H, P } = S;
      S.layer(0.1, () => { sky(g, S, -H, H); stars(g, S); sunOrMoon(g, S, W * 0.8, H * 0.2, 70); });
      for (const [d, sc] of [[0.3, 0.8], [0.6, 1.2], [0.9, 1.7]]) S.layer(d, () => { const r = rng(Math.floor(d * 50)); for (let i = 0; i < 9; i++) { const x = ((r() * W * 2 + S.t * 30 * d) % (W * 2.4)) - W * 0.7, y = r() * H; drawProp(g, 'cloud', x, y, sc * S.propScale * 1.4, P, S.t); } });
      S.keyPos = { x: W * 0.8, y: H * 0.2 };
      S.noFloor = true;
    },
  },
  underwater: {
    light: 'cool', desc: 'underwater: blue depths, light rays, bubbles, seaweed',
    draw(g, S) {
      const { W, H, GY, P } = S;
      S.layer(0.1, () => {
        const gr = g.createLinearGradient(0, -H * 0.2, 0, H); gr.addColorStop(0, css(mix(P.water, '#7fd0ff', 0.4))); gr.addColorStop(1, css(shade(P.water, -0.6))); g.fillStyle = gr; g.fillRect(-W, -H, W * 3, H * 3);
        if (!P.outline) { g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 6; i++) { const x = W * (i * 0.2) + Math.sin(S.t * 0.5 + i) * 40; g.fillStyle = css('#bfefff', 0.06); g.beginPath(); g.moveTo(x - 30, -20); g.lineTo(x + 30, -20); g.lineTo(x + 160, H); g.lineTo(x + 40, H); g.fill(); } g.restore(); }
      });
      S.layer(0.6, () => { for (let i = 0; i < 14; i++) { const x = W * (i * 0.09 - 0.1); g.strokeStyle = css(mix(P.leaf, '#2f8a6a', 0.5)); g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, GY); for (let k = 1; k < 8; k++) g.lineTo(x + Math.sin(S.t * 1.5 + k * 0.7 + i) * 14, GY - k * 34); g.stroke(); } });
      S.layer(1, () => { ground(g, S, P.sand, GY - 20); for (let i = 0; i < 30; i++) { const k = (S.t * 0.25 + i / 30) % 1; g.strokeStyle = css('#e8fbff', 0.6); g.lineWidth = 2; circle(g, (i * 137) % W + Math.sin(S.t + i) * 10, GY - k * H, 4 + (i % 4) * 2); g.stroke(); } });
      S.keyPos = { x: W / 2, y: -200 };
    },
  },
};

export const SET_IDS = Object.keys(SETS);
