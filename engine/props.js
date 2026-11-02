// Prop library. Every prop is drawn from simple shapes in palette colours.
// Ground props are drawn with their origin at bottom-centre; icons at their centre.
// Unit size: a size-1 prop is roughly 100 rig units tall.
import { TAU, circle, ellipse, roundRect, shade, css, mix, glow, luma } from './util.js';
import { drawnProps, DRAWN_GEOMETRY, deckDip, rideRig, dogPaws } from './props-drawn.js';
export { deckDip, rideRig, dogPaws };

// Fill the current path, then add the look's ink outline if it has one.
function F(g, P, color) {
  g.fillStyle = color;
  g.fill();
  if (P.outline) { g.strokeStyle = P.outline; g.lineWidth = 3; g.stroke(); }
}
function R(g, P, color, x, y, w, h, r = 0) { roundRect(g, x, y, w, h, r); F(g, P, color); }
function C(g, P, color, x, y, r) { circle(g, x, y, r); F(g, P, color); }
function E(g, P, color, x, y, rx, ry, rot = 0) { ellipse(g, x, y, rx, ry, rot); F(g, P, color); }
function poly(g, P, color, pts) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  F(g, P, color);
}
function line(g, color, w, pts) {
  g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
}
function text(g, str, x, y, size, color, weight = 700) {
  g.font = `${weight} ${size}px ${PROP_FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
  g.fillText(str, x, y);
}
const accentOf = (P, o) => o.color || P.ui.hot;

// ---------- text layout (shared by props, graphics and speech bubbles) ----------
export const PROP_FONT = '"Rubik", "Segoe UI", Arial, sans-serif';
const setFont = (g, size, family, weight) => { g.font = `${weight ? weight + ' ' : ''}${Math.max(1, Math.round(size * 100) / 100)}px ${family}`; };
const warned = new Set();

// Split on line breaks ("\n", or a literal backslash-n typed in JSON), then word-wrap each
// paragraph to maxW. With hard=true, words wider than maxW are broken by character;
// otherwise they are left whole (the caller sees the overflow and shrinks the font).
export function wrapText(g, str, maxW, hard = false) {
  const out = [];
  for (const para of String(str ?? '').replace(/\r/g, '').replace(/\n/g, '\n').split('\n')) {
    const words = para.split(/[ \t]+/).filter(Boolean);
    let cur = '';
    for (let w of words) {
      if (hard) {
        while (w.length > 1 && g.measureText(w).width > maxW) {
          if (cur) { out.push(cur); cur = ''; }
          let n = w.length - 1;
          while (n > 1 && g.measureText(w.slice(0, n)).width > maxW) n--;
          out.push(w.slice(0, n)); w = w.slice(n);
        }
      }
      const t = cur ? cur + ' ' + w : w;
      if (cur && g.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t;
    }
    out.push(cur);
  }
  return out;
}

// Lay text out inside a box {w, h}: honours line breaks, word-wraps to box.w and shrinks
// the font (maxSize -> minSize) until every line fits box.w and the block fits box.h.
// If it still does not fit at minSize, long words are broken and the last line ends in
// an ellipsis (with a one-time warning). Leaves g.font set to the result. Returns
// {lines, size, lineHeight, width, height, truncated}.
export function layoutText(g, str, box, opts = {}) {
  const maxSize = opts.maxSize ?? 36;
  const minSize = Math.min(maxSize, opts.minSize ?? maxSize * 0.45);
  const lh = opts.lineHeight ?? 1.18;
  const family = opts.family || PROP_FONT;
  const weight = opts.weight ?? 700;
  const maxLines = opts.maxLines ?? Infinity;
  const s = String(str ?? '');
  const measure = (size, hard) => {
    setFont(g, size, family, weight);
    const lines = wrapText(g, s, box.w, hard);
    const width = Math.max(0, ...lines.map((l) => g.measureText(l).width));
    return { lines, size, lineHeight: size * lh, width, height: lines.length * size * lh, truncated: false };
  };
  const fits = (L) => L.lines.length <= maxLines && L.height <= box.h + 0.5 && L.width <= box.w + 0.5;
  for (let size = maxSize; size > minSize; size *= 0.94) {
    const L = measure(size, false);
    if (fits(L)) return L;
  }
  let L = measure(minSize, false);
  if (fits(L)) return L;
  L = measure(minSize, true);
  if (fits(L)) return L;
  // Still too much text: keep what fits and end with an ellipsis.
  const n = Math.max(1, Math.min(maxLines, Math.floor((box.h + 0.5) / L.lineHeight)));
  if (L.lines.length > n) {
    const lines = L.lines.slice(0, n);
    let last = lines[n - 1];
    while (last.length && g.measureText(last + '\u2026').width > box.w) last = last.slice(0, -1);
    lines[n - 1] = last.replace(/\s+$/, '') + '\u2026';
    L.lines = lines;
  }
  L.width = Math.max(0, ...L.lines.map((l) => g.measureText(l).width));
  L.height = L.lines.length * L.lineHeight;
  L.truncated = true;
  if (!warned.has(s)) { warned.add(s); console.warn(`[stickframe] text too long for its box, truncated: "${s.slice(0, 60)}"`); }
  return L;
}

// Draw a laid-out block centred on (cx, cy). align 'left' starts lines at cx - boxW/2.
export function drawTextBlock(g, L, cx, cy, color, opts = {}) {
  g.save();
  // A mirrored prop (flip) must not mirror its writing.
  const m = g.getTransform ? g.getTransform() : null;
  if (m && m.a * m.d - m.b * m.c < 0) { g.translate(cx, 0); g.scale(-1, 1); g.translate(-cx, 0); }
  g.textAlign = opts.align === 'left' ? 'left' : 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  const x = opts.align === 'left' ? cx - (opts.boxW ?? L.width) / 2 : cx;
  L.lines.forEach((ln, i) => g.fillText(ln, x, cy + (i - (L.lines.length - 1) / 2) * L.lineHeight));
  g.restore();
}

// Text inside a prop's container: container area (w x h) centred on (cx, cy), ~8% padding.
function boxText(g, str, cx, cy, w, h, maxSize, color, weight = 700) {
  const box = { w: w * 0.84, h: h * 0.84 };
  const L = layoutText(g, str, box, { maxSize, minSize: Math.min(maxSize, Math.max(5, maxSize * 0.4)), weight, family: PROP_FONT, lineHeight: 1.15 });
  drawTextBlock(g, L, cx, cy, color);
  return L;
}

export const PROPS = {
  // ---------- furniture & rooms ----------
  desk: { ground: true, draw(g, P) { R(g, P, P.wood, -90, -78, 180, 12, 3); R(g, P, P.woodDark, -82, -66, 10, 66); R(g, P, P.woodDark, 72, -66, 10, 66); R(g, P, P.wood, 30, -66, 46, 40, 3); } },
  table: { ground: true, draw(g, P) { E(g, P, P.wood, 0, -74, 80, 12); R(g, P, P.woodDark, -6, -70, 12, 70); R(g, P, P.woodDark, -30, -6, 60, 6, 3); } },
  chair: { ground: true, draw(g, P) { R(g, P, P.wood, -26, -44, 52, 8, 3); R(g, P, P.woodDark, -24, -38, 7, 38); R(g, P, P.woodDark, 17, -38, 7, 38); R(g, P, P.wood, -30, -100, 8, 60, 3); } },
  stool: { ground: true, draw(g, P) { E(g, P, P.wood, 0, -46, 26, 7); line(g, P.woodDark, 6, [-14, -42, -20, 0]); line(g, P.woodDark, 6, [14, -42, 20, 0]); } },
  bed: { ground: true, draw(g, P) { R(g, P, P.woodDark, -120, -44, 240, 28, 4); R(g, P, P.fabric, -116, -56, 232, 18, 8); R(g, P, P.propLight, -112, -68, 54, 16, 8); R(g, P, P.wood, -128, -96, 14, 96, 4); R(g, P, P.wood, 114, -64, 14, 64, 4); } },
  couch: { ground: true, draw(g, P) { R(g, P, P.fabric, -110, -90, 220, 50, 16); R(g, P, shade(P.fabric, 0.1), -100, -52, 200, 30, 10); R(g, P, shade(P.fabric, -0.15), -122, -66, 30, 56, 12); R(g, P, shade(P.fabric, -0.15), 92, -66, 30, 56, 12); R(g, P, P.propDark, -100, -12, 10, 12); R(g, P, P.propDark, 90, -12, 10, 12); } },
  lamp: { ground: true, draw(g, P, t, o) { if (!P.outline) glow(g, 0, -150, 140, P.key, 0.45); line(g, P.metal, 5, [0, 0, 0, -140]); E(g, P, P.propDark, 0, -2, 24, 5); poly(g, P, P.windowLit, [-28, -132, 28, -132, 16, -172, -16, -172]); } },
  bookshelf: { ground: true, draw(g, P) { R(g, P, P.woodDark, -60, -200, 120, 200, 3); const cols = [P.ui.hot, P.ui.cool, P.ui.gold, P.propLight, P.fabric]; for (let r = 0; r < 4; r++) { R(g, P, P.wood, -56, -150 + r * 48, 112, 6); for (let i = 0; i < 7; i++) R(g, P, cols[(i + r * 2) % cols.length], -50 + i * 15, -188 + r * 48, 11, 36 - ((i * 7 + r) % 3) * 5, 2); } } },
  door: { k: 1.15, ground: true, draw(g, P) { R(g, P, P.woodDark, -46, -200, 92, 200, 3); R(g, P, P.wood, -38, -192, 76, 192, 2); C(g, P, P.ui.gold, 26, -96, 5); } },
  fridge: { ground: true, draw(g, P) { R(g, P, P.propLight, -40, -190, 80, 190, 10); line(g, P.propDark, 3, [-40, -120, 40, -120]); line(g, P.propDark, 5, [28, -170, 28, -140]); line(g, P.propDark, 5, [28, -100, 28, -60]); } },
  counter: { ground: true, draw(g, P) { R(g, P, P.wood, -130, -84, 260, 84, 3); R(g, P, P.propLight, -136, -92, 272, 12, 3); for (let i = 0; i < 3; i++) R(g, P, P.woodDark, -118 + i * 84, -70, 70, 60, 4); } },
  whiteboard: { ground: false, h: 150, draw(g, P, t, o) { R(g, P, P.metal, -120, -78, 240, 156, 6); R(g, P, '#f6f7f2', -112, -70, 224, 140, 4); if (o.text) boxText(g, o.text, 0, 0, 224, 140, 34, '#2a2a33'); } },
  tv: { ground: false, h: 120, draw(g, P, t, o) { R(g, P, P.propDark, -110, -66, 220, 132, 8); R(g, P, P.screen, -100, -56, 200, 112, 4); if (o.text) boxText(g, o.text, 0, 0, 200, 112, 30, '#1a2230'); } },
  monitor: { ground: true, draw(g, P, t, o) { R(g, P, P.propDark, -8, -40, 16, 40); R(g, P, P.propDark, -30, -6, 60, 6, 3); R(g, P, P.propDark, -64, -110, 128, 76, 6); R(g, P, P.screen, -58, -104, 116, 64, 3); if (!P.outline) glow(g, 0, -72, 120, P.screen, 0.25); if (o.text) boxText(g, o.text, 0, -72, 116, 64, 18, '#1a2230'); } },
  laptop: { ground: true, draw(g, P) { poly(g, P, P.metal, [-50, 0, 50, 0, 40, -8, -40, -8]); poly(g, P, P.propDark, [-40, -8, -32, -64, 32, -64, 40, -8]); poly(g, P, P.screen, [-34, -12, -28, -58, 28, -58, 34, -12]); } },
  computer: { ground: true, draw(g, P, t, o) { PROPS.monitor.draw(g, P, t, o); R(g, P, P.propLight, -50, -6, 100, 6, 2); } },
  sign: { ground: true, draw(g, P, t, o) { R(g, P, P.woodDark, -6, -150, 12, 150); R(g, P, P.wood, -80, -200, 160, 70, 6); if (o.text) boxText(g, o.text, 0, -165, 160, 70, 26, luma(P.wood) < 0.45 ? '#fbf6ea' : '#2a1d10'); } },
  board: { ground: false, h: 160, draw(g, P, t, o) { R(g, P, P.woodDark, -150, -90, 300, 180, 6); R(g, P, '#24433a', -140, -80, 280, 160, 3); if (o.text) boxText(g, o.text, 0, 0, 280, 160, 36, '#eef0e6', 600); } },
  podium: { ground: true, draw(g, P) { poly(g, P, P.wood, [-46, 0, 46, 0, 38, -110, -38, -110]); R(g, P, P.woodDark, -50, -122, 100, 14, 4); } },
  window: { ground: false, h: 160, draw(g, P) { R(g, P, P.wallDark, -84, -94, 168, 188, 4); const gr = g.createLinearGradient(0, -86, 0, 86); gr.addColorStop(0, css(P.skyTop)); gr.addColorStop(1, css(P.skyBot)); g.fillStyle = gr; g.fillRect(-76, -86, 152, 172); line(g, P.wallDark, 8, [0, -86, 0, 86]); line(g, P.wallDark, 8, [-76, 0, 76, 0]); } },
  plant: { ground: true, draw(g, P) { poly(g, P, P.wood, [-22, 0, 22, 0, 28, -40, -28, -40]); for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.42; E(g, P, P.leaf, Math.cos(a) * 34, -46 + Math.sin(a) * 40, 12, 26, a + Math.PI / 2); } } },
  // ---------- outdoors ----------
  tree: { ground: true, draw(g, P) { R(g, P, P.woodDark, -12, -120, 24, 120, 4); C(g, P, P.leaf, 0, -170, 70); C(g, P, shade(P.leaf, 0.08), -46, -138, 46); C(g, P, shade(P.leaf, -0.08), 48, -142, 50); } },
  pine: { ground: true, draw(g, P) { R(g, P, P.woodDark, -9, -40, 18, 40); poly(g, P, shade(P.leaf, -0.1), [-70, -40, 70, -40, 0, -150]); poly(g, P, P.leaf, [-56, -100, 56, -100, 0, -210]); } },
  bush: { ground: true, draw(g, P) { C(g, P, P.leaf, -30, -30, 34); C(g, P, shade(P.leaf, 0.1), 10, -44, 40); C(g, P, shade(P.leaf, -0.08), 42, -26, 28); } },
  flower: { ground: true, draw(g, P, t, o) { line(g, P.leaf, 5, [0, 0, 0, -60]); for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + t * 0.5; C(g, P, accentOf(P, o), Math.cos(a) * 12, -66 + Math.sin(a) * 12, 9); } C(g, P, P.ui.gold, 0, -66, 7); } },
  rock: { ground: true, draw(g, P) { poly(g, P, P.rock, [-60, 0, -50, -34, -14, -56, 30, -48, 58, -16, 64, 0]); } },
  bridge: { k: 1.6, ground: true, draw(g, P, t, o) { const c = o.color || P.metal; R(g, P, c, -170, -70, 340, 14, 3); g.lineWidth = 8; g.strokeStyle = c; g.beginPath(); g.moveTo(-170, -56); g.quadraticCurveTo(0, -170, 170, -56); g.stroke(); for (let i = -4; i <= 4; i++) { const x = i * 34, y = -56 - 114 * (1 - (x / 170) ** 2) * 0.5; line(g, c, 3, [x, -70, x, y]); } R(g, P, shade(c, -0.2), -160, -56, 16, 56); R(g, P, shade(c, -0.2), 144, -56, 16, 56); } },
  dog: { ground: true, draw(g, P, t, o) { const c = o.color || '#c89a5a', wag = Math.sin(t * 12) * 0.5; E(g, P, c, 0, -40, 42, 20); C(g, P, c, 42, -62, 18); E(g, P, shade(c, -0.25), 50, -78, 7, 12, 0.4); C(g, P, P.propDark, 47, -66, 3); C(g, P, P.propDark, 60, -58, 4); for (const x of o.legs === 3 ? [-26, 22, 0] : [-26, -12, 12, 26]) line(g, shade(c, -0.15), 7, [x, -26, x, 0]); g.save(); g.translate(-40, -48); g.rotate(-0.8 + wag); line(g, c, 6, [0, 0, -22, -10]); g.restore(); } },
  bird: { ground: false, h: 50, draw(g, P, t, o) { const c = o.color || P.propLight, f = Math.sin(t * 14 + (o.seed || 0)) * 16; g.scale(1.8, 1.8); E(g, P, c, 0, 0, 16, 9); C(g, P, c, 14, -6, 7); poly(g, P, P.ui.gold, [20, -6, 28, -4, 20, -2]); line(g, c, 5, [-4, -2, -18, -12 - f]); line(g, c, 5, [4, -2, -6, -14 - f]); } },
  wings: { ground: false, h: 90, draw(g, P, t, o) { const c = o.color || '#f6f4ee', f = Math.sin(t * 8) * 0.25; for (const s of [-1, 1]) { g.save(); g.scale(s, 1); g.rotate(f); g.beginPath(); g.moveTo(6, 0); g.quadraticCurveTo(60, -70, 110, -40); g.quadraticCurveTo(80, -20, 96, -4); g.quadraticCurveTo(60, 0, 70, 20); g.quadraticCurveTo(30, 10, 6, 0); F(g, P, c); g.restore(); } } },
  bench: { ground: true, draw(g, P) { R(g, P, P.wood, -90, -52, 180, 10, 3); R(g, P, P.wood, -90, -96, 180, 10, 3); R(g, P, P.metal, -80, -96, 8, 96); R(g, P, P.metal, 72, -96, 8, 96); } },
  streetlamp: { ground: true, draw(g, P) { if (P.night && !P.outline) { glow(g, 26, -250, 200, P.windowLit, 0.5); } line(g, P.propDark, 8, [0, 0, 0, -250, 26, -260]); poly(g, P, P.propDark, [10, -256, 44, -256, 36, -246, 16, -246]); if (P.night) E(g, P, P.windowLit, 26, -243, 12, 5); } },
  car: { k: 1.8, ground: true, draw(g, P, t, o) { const c = o.color || P.ui.hot; R(g, P, c, -110, -60, 220, 40, 14); poly(g, P, shade(c, -0.1), [-60, -58, -36, -96, 44, -96, 72, -58]); poly(g, P, P.screen, [-48, -60, -30, -88, 2, -88, 2, -60]); poly(g, P, P.screen, [10, -60, 10, -88, 40, -88, 60, -60]); C(g, P, P.propDark, -62, -20, 20); C(g, P, P.propDark, 62, -20, 20); C(g, P, P.metal, -62, -20, 8); C(g, P, P.metal, 62, -20, 8); } },
  bus: { k: 1.7, ground: true, draw(g, P, t, o) { const c = o.color || P.ui.gold; R(g, P, c, -170, -140, 340, 118, 14); for (let i = 0; i < 5; i++) R(g, P, P.screen, -150 + i * 62, -126, 50, 40, 4); C(g, P, P.propDark, -110, -22, 22); C(g, P, P.propDark, 110, -22, 22); } },
  bike: { k: 1.3, ground: true, draw(g, P) { g.lineWidth = 5; g.strokeStyle = P.propDark; circle(g, -44, -30, 30); g.stroke(); circle(g, 44, -30, 30); g.stroke(); line(g, P.ui.hot, 6, [-44, -30, -6, -30, 20, -70, -20, -70, -6, -30]); line(g, P.ui.hot, 6, [20, -70, 44, -30]); line(g, P.propDark, 5, [-24, -78, -14, -78]); line(g, P.propDark, 5, [16, -82, 28, -86]); } },
  house: { k: 1.6, ground: true, draw(g, P, t, o) { R(g, P, P.wallLight, -110, -150, 220, 150); poly(g, P, o.color || P.ui.hot, [-130, -150, 0, -240, 130, -150]); R(g, P, P.woodDark, -24, -80, 48, 80, 3); R(g, P, P.windowLit, -90, -120, 46, 40, 3); R(g, P, P.windowLit, 44, -120, 46, 40, 3); } },
  building: { k: 1.3, ground: true, draw(g, P, t, o) { R(g, P, shade(P.wall, -0.2), -90, -400, 180, 400); for (let r = 0; r < 9; r++) for (let c = 0; c < 4; c++) R(g, P, (r * 3 + c) % 5 === 0 ? P.windowLit : shade(P.wall, -0.35), -74 + c * 40, -380 + r * 42, 26, 28, 2); } },
  tent: { k: 1.3, ground: true, draw(g, P, t, o) { poly(g, P, o.color || P.ui.gold, [-100, 0, 0, -120, 100, 0]); poly(g, P, shade(o.color || P.ui.gold, -0.35), [-24, 0, 0, -70, 24, 0]); } },
  campfire: { k: 0.8, ground: true, draw(g, P, t) { if (!P.outline) glow(g, 0, -30, 180, '#ff9a3c', 0.55); line(g, P.woodDark, 10, [-34, -4, 34, -14]); line(g, P.woodDark, 10, [-34, -14, 34, -4]); const k = Math.sin(t * 12) * 4; poly(g, P, '#ff7a2a', [-26, -8, 0, -70 - k, 26, -8]); poly(g, P, '#ffd35a', [-12, -8, 2, -44 + k, 14, -8]); } },
  boat: { k: 1.4, ground: true, draw(g, P, t, o) { poly(g, P, o.color || P.wood, [-110, -50, 110, -50, 80, 0, -80, 0]); line(g, P.propDark, 5, [0, -50, 0, -190]); poly(g, P, P.propLight, [6, -184, 6, -60, 80, -60]); } },
  rocket: { k: 1.2, ground: false, h: 200, draw(g, P, t, o) { const c = o.color || P.ui.hot; if (o.fire !== false) { const k = Math.sin(t * 30) * 8; poly(g, P, '#ffb13c', [-18, 70, 0, 130 + k, 18, 70]); poly(g, P, '#fff0a0', [-9, 70, 0, 100 + k, 9, 70]); } R(g, P, P.propLight, -30, -60, 60, 130, 26); poly(g, P, c, [-30, -40, 0, -110, 30, -40]); poly(g, P, c, [-30, 40, -56, 80, -30, 70]); poly(g, P, c, [30, 40, 56, 80, 30, 70]); C(g, P, P.screen, 0, -10, 13); } },
  plane: { ground: false, h: 80, draw(g, P, t, o) { E(g, P, P.propLight, 0, 0, 120, 20); poly(g, P, o.color || P.ui.cool, [-10, 0, 30, 0, -20, 80, -40, 80]); poly(g, P, o.color || P.ui.cool, [-90, -4, -110, -50, -96, -50, -70, -4]); for (let i = 0; i < 6; i++) C(g, P, P.screen, -50 + i * 22, -4, 5); } },
  // ---------- small objects (usually held or floating) ----------
  pencil: { ground: false, h: 60, draw(g, P, t, o) { g.save(); g.rotate(-0.6); R(g, P, o.color || P.ui.gold, -8, -40, 16, 56, 2); R(g, P, '#e88a9a', -8, -48, 16, 10, 3); poly(g, P, '#e8c99a', [-8, 16, 8, 16, 0, 34]); poly(g, P, P.propDark, [-3, 27, 3, 27, 0, 34]); g.restore(); } },
  notebook: { ground: false, h: 70, draw(g, P, t, o) { R(g, P, o.color || P.ui.cool, -46, -34, 92, 68, 4); R(g, P, '#f6f4ee', -40, -30, 80, 60, 2); for (let i = 0; i < 5; i++) line(g, css('#9fb7d8', 0.7), 1.5, [-34, -18 + i * 10, 34, -18 + i * 10]); for (let i = 0; i < 6; i++) C(g, P, P.propDark, -46, -26 + i * 11, 3); if (o.text) boxText(g, o.text, 0, 0, 80, 60, 16, '#2a2a33'); } },
  paper: { ground: false, h: 70, draw(g, P, t, o) { poly(g, P, '#f6f4ee', [-32, -42, 20, -42, 32, -30, 32, 42, -32, 42]); poly(g, P, '#d9d6cc', [20, -42, 20, -30, 32, -30]); if (o.text) boxText(g, o.text, 0, 0, 64, 84, 16, '#2a2a33'); else for (let i = 0; i < 5; i++) line(g, '#b8b4a8', 2, [-22, -20 + i * 12, 22 - (i % 2) * 10, -20 + i * 12]); } },
  phone: { ground: false, h: 60, draw(g, P, t, o) { R(g, P, P.propDark, -18, -32, 36, 64, 6); R(g, P, P.screen, -14, -26, 28, 50, 3); if (!P.outline && o.glow !== false) glow(g, 0, 0, 70, P.screen, 0.25); } },
  book: { ground: false, h: 50, draw(g, P, t, o) { R(g, P, o.color || P.ui.hot, -28, -20, 56, 40, 3); R(g, P, P.propLight, -24, -16, 48, 32, 2); line(g, P.propDark, 2, [0, -16, 0, 16]); } },
  cup: { ground: false, h: 40, draw(g, P, t, o) { R(g, P, o.color || P.propLight, -14, -18, 28, 36, 5); g.lineWidth = 5; g.strokeStyle = o.color || P.propLight; g.beginPath(); g.arc(16, 0, 9, -1.2, 1.2); g.stroke(); line(g, css(P.propLight, 0.6), 3, [-4, -24, -2, -34]); line(g, css(P.propLight, 0.6), 3, [5, -24, 7, -36]); } },
  clock: { ground: false, h: 90, draw(g, P, t, o) { C(g, P, P.propDark, 0, 0, 46); C(g, P, '#f4f1e8', 0, 0, 40); const s = (o.speed || 1) * t; line(g, '#222', 5, [0, 0, Math.sin(s * 0.5) * 22, -Math.cos(s * 0.5) * 22]); line(g, '#c33', 3, [0, 0, Math.sin(s * 6) * 32, -Math.cos(s * 6) * 32]); C(g, P, '#222', 0, 0, 4); } },
  alarm: { ground: false, h: 90, draw(g, P, t, o) { const k = o.ring === false ? 0 : Math.sin(t * 40) * 0.08; g.rotate(k); C(g, P, P.ui.hot, -26, -36, 14); C(g, P, P.ui.hot, 26, -36, 14); PROPS.clock.draw(g, P, t, o); } },
  stopwatch: { ground: false, h: 90, draw(g, P, t, o) { R(g, P, P.propDark, -8, -58, 16, 14, 3); PROPS.clock.draw(g, P, t, { ...o, speed: 8 }); } },
  hourglass: { ground: false, h: 100, draw(g, P, t, o) { R(g, P, P.wood, -36, -56, 72, 10, 3); R(g, P, P.wood, -36, 46, 72, 10, 3); poly(g, P, css(P.screen, 0.5), [-28, -46, 28, -46, 4, 0, 28, 46, -28, 46, -4, 0]); const k = (t * 0.15) % 1; poly(g, P, P.sand, [-20 * (1 - k), -36 + k * 30, 20 * (1 - k), -36 + k * 30, 0, -4]); poly(g, P, P.sand, [-24, 46, 24, 46, 0, 46 - 30 * k - 6]); } },
  calendar: { ground: false, h: 100, draw(g, P, t, o) { R(g, P, '#f6f4ee', -46, -46, 92, 92, 6); R(g, P, P.ui.hot, -46, -46, 92, 26, 6); boxText(g, o.text || '1', 0, 13, 92, 66, 40, '#2a2a33', 800); } },
  money: { ground: false, h: 50, draw(g, P) { for (let i = 0; i < 3; i++) { R(g, P, '#5fb86a', -44 + i * 4, -18 - i * 6, 88, 40, 4); } C(g, P, '#3f8a4a', 4, -10, 12); text(g, '$', 4, -10, 18, '#e8ffe8', 800); } },
  cash: { ground: true, draw(g, P) { for (let i = 0; i < 6; i++) R(g, P, '#5fb86a', -46 + (i % 2) * 6, -14 - i * 13, 92, 12, 2); } },
  coin: { ground: false, h: 50, draw(g, P, t) { const sx = Math.abs(Math.cos(t * 3)) * 0.8 + 0.2; g.scale(sx, 1); C(g, P, '#f2c14e', 0, 0, 26); C(g, P, '#d9a52f', 0, 0, 19); text(g, '$', 0, 1, 24, '#fff4c8', 800); } },
  goldbar: { ground: true, draw(g, P) { poly(g, P, '#f2c14e', [-50, 0, 50, 0, 36, -30, -36, -30]); poly(g, P, '#ffe08a', [-36, -30, 36, -30, 30, -36, -30, -36]); } },
  chest: { ground: true, draw(g, P) { R(g, P, P.wood, -60, -60, 120, 60, 4); g.beginPath(); g.moveTo(-60, -60); g.quadraticCurveTo(0, -110, 60, -60); g.closePath(); F(g, P, P.woodDark); R(g, P, P.ui.gold, -8, -68, 16, 20, 2); } },
  gift: { ground: true, draw(g, P, t, o) { const c = o.color || P.ui.hot; R(g, P, c, -40, -70, 80, 70, 4); R(g, P, P.ui.gold, -7, -70, 14, 70); R(g, P, shade(c, 0.1), -46, -82, 92, 16, 3); E(g, P, P.ui.gold, -14, -90, 14, 8, -0.4); E(g, P, P.ui.gold, 14, -90, 14, 8, 0.4); } },
  box: { ground: true, draw(g, P) { R(g, P, mix(P.wood, '#c89a5a', 0.4), -46, -76, 92, 76, 3); line(g, P.woodDark, 3, [-46, -60, 46, -60]); R(g, P, '#d9c49a', -10, -76, 20, 16); } },
  ball: { ground: false, h: 50, draw(g, P, t, o) { C(g, P, o.color || P.ui.hot, 0, 0, 24); line(g, '#ffffff', 3, [-24, 0, 24, 0]); g.strokeStyle = '#fff'; g.beginPath(); g.arc(0, 0, 24, -0.6, 0.6); g.stroke(); } },
  trophy: { ground: true, draw(g, P) { R(g, P, P.propDark, -30, -16, 60, 16, 3); R(g, P, '#f2c14e', -8, -48, 16, 34); g.beginPath(); g.moveTo(-36, -110); g.lineTo(36, -110); g.quadraticCurveTo(36, -46, 0, -46); g.quadraticCurveTo(-36, -46, -36, -110); F(g, P, '#f2c14e'); g.lineWidth = 6; g.strokeStyle = '#f2c14e'; g.beginPath(); g.arc(-36, -92, 14, Math.PI * 0.5, Math.PI * 1.5); g.stroke(); g.beginPath(); g.arc(36, -92, 14, -Math.PI * 0.5, Math.PI * 0.5); g.stroke(); } },
  medal: { ground: false, h: 80, draw(g, P) { poly(g, P, P.ui.hot, [-20, -60, -4, -60, 6, -10, -10, -10]); poly(g, P, P.ui.cool, [20, -60, 4, -60, -6, -10, 10, -10]); C(g, P, '#f2c14e', 0, 10, 22); text(g, '1', 0, 11, 22, '#8a6410', 800); } },
  pizza: { ground: false, h: 60, draw(g, P) { poly(g, P, '#f2c14e', [-34, -26, 34, -26, 0, 40]); R(g, P, '#c98a3a', -38, -34, 76, 12, 6); C(g, P, '#d6402f', -10, -8, 6); C(g, P, '#d6402f', 10, -6, 6); C(g, P, '#d6402f', 0, 14, 5); } },
  sandwich: { ground: false, h: 50, draw(g, P) { poly(g, P, '#e6c08a', [-40, 14, 40, 14, 0, -34]); R(g, P, '#5fb86a', -38, 6, 76, 6, 3); R(g, P, '#d6402f', -34, 10, 68, 5, 2); poly(g, P, '#d9a86a', [-40, 22, 40, 22, 40, 14, -40, 14]); } },
  burger: { ground: false, h: 60, draw(g, P) { g.beginPath(); g.arc(0, -4, 36, Math.PI, TAU); g.closePath(); F(g, P, '#e0a24a'); R(g, P, '#5fb86a', -38, -6, 76, 7, 3); R(g, P, '#7a3f22', -36, 1, 72, 12, 5); R(g, P, '#e0a24a', -34, 13, 68, 12, 6); } },
  apple: { ground: false, h: 60, draw(g, P) { C(g, P, '#d6402f', -9, 4, 22); C(g, P, '#d6402f', 9, 4, 22); line(g, P.woodDark, 4, [0, -14, 3, -28]); E(g, P, P.leaf, 12, -24, 9, 5, -0.4); } },
  bottle: { ground: true, draw(g, P, t, o) { R(g, P, css(o.color || P.ui.cool, 0.85), -16, -70, 32, 70, 8); R(g, P, css(o.color || P.ui.cool, 0.85), -7, -90, 14, 24, 3); R(g, P, P.propLight, -14, -48, 28, 18, 2); } },
  pill: { ground: false, h: 40, draw(g, P) { g.save(); g.rotate(-0.6); R(g, P, '#ffffff', -26, -11, 26, 22, 11); R(g, P, P.ui.hot, 0, -11, 26, 22, 11); g.restore(); } },
  key: { ground: false, h: 50, draw(g, P) { g.lineWidth = 8; g.strokeStyle = '#f2c14e'; circle(g, -24, 0, 14); g.stroke(); line(g, '#f2c14e', 8, [-10, 0, 34, 0, 34, 12]); line(g, '#f2c14e', 6, [22, 0, 22, 10]); } },
  lock: { ground: false, h: 70, draw(g, P) { g.lineWidth = 9; g.strokeStyle = P.metal; g.beginPath(); g.arc(0, -16, 20, Math.PI, TAU); g.stroke(); R(g, P, '#f2c14e', -30, -16, 60, 48, 6); C(g, P, P.propDark, 0, 4, 6); } },
  magnifier: { ground: false, h: 80, draw(g, P) { line(g, P.woodDark, 12, [18, 18, 46, 46]); g.lineWidth = 8; g.strokeStyle = P.metal; circle(g, 0, 0, 26); g.stroke(); circle(g, 0, 0, 22); g.fillStyle = css(P.screen, 0.35); g.fill(); } },
  umbrella: { ground: false, h: 100, draw(g, P, t, o) { line(g, P.propDark, 5, [0, -40, 0, 50, -10, 56]); g.beginPath(); g.arc(0, -40, 60, Math.PI, TAU); g.closePath(); F(g, P, o.color || P.ui.hot); } },
  briefcase: { ground: false, h: 60, draw(g, P) { R(g, P, P.woodDark, -40, -22, 80, 52, 6); g.lineWidth = 6; g.strokeStyle = P.woodDark; roundRect(g, -14, -36, 28, 18, 5); g.stroke(); R(g, P, P.ui.gold, -6, -6, 12, 8, 2); } },
  backpack: { ground: false, h: 70, draw(g, P, t, o) { R(g, P, o.color || P.ui.cool, -30, -38, 60, 76, 18); R(g, P, shade(o.color || P.ui.cool, -0.2), -22, 4, 44, 26, 6); } },
  guitar: { ground: false, h: 120, draw(g, P) { g.save(); g.rotate(-0.5); C(g, P, P.wood, 0, 30, 30); C(g, P, P.wood, 0, -2, 22); C(g, P, P.propDark, 0, 14, 8); R(g, P, P.woodDark, -5, -90, 10, 90); g.restore(); } },
  microphone: { ground: false, h: 70, draw(g, P) { R(g, P, P.propDark, -6, -6, 12, 50, 5); C(g, P, P.metal, 0, -16, 16); } },
  camera: { ground: false, h: 60, draw(g, P) { R(g, P, P.propDark, -40, -24, 80, 52, 8); R(g, P, P.propDark, -16, -34, 30, 12, 3); C(g, P, P.metal, 4, 2, 18); C(g, P, P.screen, 4, 2, 10); } },
  syringe: { ground: false, h: 40, draw(g, P) { R(g, P, css(P.screen, 0.7), -36, -9, 56, 18, 3); line(g, P.metal, 3, [20, 0, 44, 0]); R(g, P, P.propDark, -46, -12, 10, 24, 2); } },
  dna: { ground: false, h: 140, draw(g, P, t) { for (let i = 0; i < 14; i++) { const y = -70 + i * 10, a = i * 0.6 + t * 2; const x1 = Math.sin(a) * 30, x2 = -x1; line(g, css(P.ui.cool, 0.7), 3, [x1, y, x2, y]); C(g, P, P.ui.cool, x1, y, 5); C(g, P, P.ui.hot, x2, y, 5); } } },
  atom: { ground: false, h: 120, draw(g, P, t) { C(g, P, P.ui.hot, 0, 0, 12); g.strokeStyle = P.ui.cool; g.lineWidth = 4; for (let i = 0; i < 3; i++) { ellipse(g, 0, 0, 60, 20, i * Math.PI / 3 + t * 0.4); g.stroke(); const a = t * 3 + i * 2; const ca = Math.cos(i * Math.PI / 3 + t * 0.4), sa = Math.sin(i * Math.PI / 3 + t * 0.4); C(g, P, P.ui.gold, Math.cos(a) * 60 * ca - Math.sin(a) * 20 * sa, Math.cos(a) * 60 * sa + Math.sin(a) * 20 * ca, 6); } } },
  // ---------- icons / symbols ----------
  heart: { ground: false, h: 70, draw(g, P, t, o) { const k = o.beat ? 1 + Math.max(0, Math.sin(t * 7)) * 0.12 : 1; g.scale(k, k); g.beginPath(); g.moveTo(0, 30); g.bezierCurveTo(-60, -4, -30, -50, 0, -22); g.bezierCurveTo(30, -50, 60, -4, 0, 30); F(g, P, o.color || '#ff4f6b'); } },
  brain: { ground: false, h: 80, draw(g, P, t, o) { const c = o.color || '#ff9ab5'; C(g, P, c, -18, -8, 26); C(g, P, c, 16, -10, 28); C(g, P, c, -6, 12, 24); C(g, P, c, 22, 12, 20); line(g, shade(c, -0.25), 3, [-2, -30, 2, 26]); } },
  lightbulb: { ground: false, h: 90, draw(g, P, t, o) { const on = o.on !== false; if (on && !P.outline) glow(g, 0, -10, 120, '#ffe06a', 0.6); C(g, P, on ? '#ffe06a' : P.propLight, 0, -12, 32); R(g, P, P.metal, -14, 16, 28, 20, 4); if (on) { for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.45; line(g, '#ffe06a', 4, [Math.cos(a) * 44, -12 + Math.sin(a) * 44, Math.cos(a) * 58, -12 + Math.sin(a) * 58]); } } } },
  globe: { ground: false, h: 100, draw(g, P, t) { C(g, P, '#3f8fd6', 0, 0, 46); g.save(); circle(g, 0, 0, 46); g.clip(); g.fillStyle = '#5fb86a'; const o = (t * 12) % 92; for (const dx of [-92, 0, 92]) { ellipse(g, -20 + o + dx, -14, 20, 14); g.fill(); ellipse(g, 12 + o + dx, 18, 16, 22); g.fill(); ellipse(g, 30 + o + dx, -22, 10, 8); g.fill(); } g.restore(); g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2; circle(g, 0, 0, 46); g.stroke(); } },
  star: { ground: false, h: 70, draw(g, P, t, o) { const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 15 : 34; pts.push(Math.cos(a) * r, Math.sin(a) * r); } poly(g, P, o.color || P.ui.gold, pts); } },
  sun: { ground: false, h: 120, draw(g, P, t) { if (!P.outline) glow(g, 0, 0, 160, '#ffd35a', 0.5); C(g, P, '#ffd35a', 0, 0, 40); for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + t * 0.3; line(g, '#ffd35a', 6, [Math.cos(a) * 52, Math.sin(a) * 52, Math.cos(a) * 66, Math.sin(a) * 66]); } } },
  moon: { ground: false, h: 100, draw(g, P) { if (!P.outline) glow(g, 0, 0, 140, '#e8f0ff', 0.35); C(g, P, '#eef2ff', 0, 0, 40); C(g, P, '#d7def0', -12, -8, 8); C(g, P, '#d7def0', 14, 12, 6); } },
  cloud: { ground: false, h: 70, draw(g, P, t, o) { const c = o.color || (P.night ? shade(P.skyBot, 0.15) : '#ffffff'); C(g, P, c, -36, 6, 26); C(g, P, c, 0, -8, 36); C(g, P, c, 36, 6, 24); R(g, P, c, -60, 6, 120, 26, 13); } },
  raincloud: { ground: false, h: 110, draw(g, P, t) { const c = shade(P.skyTop, 0.2); C(g, P, c, -36, 6, 26); C(g, P, c, 0, -8, 36); C(g, P, c, 36, 6, 24); for (let i = 0; i < 6; i++) { const y = 40 + ((t * 120 + i * 37) % 60); line(g, P.ui.cool, 3, [-40 + i * 16, y, -44 + i * 16, y + 12]); } } },
  bolt: { ground: false, h: 100, draw(g, P, t, o) { if (!P.outline) glow(g, 0, 0, 100, '#ffe06a', 0.4); poly(g, P, o.color || '#ffe06a', [8, -60, -24, 6, -2, 6, -10, 60, 24, -8, 2, -8]); } },
  fire: { ground: false, h: 100, draw(g, P, t) { const k = Math.sin(t * 14) * 5; if (!P.outline) glow(g, 0, 10, 120, '#ff8a3c', 0.5); g.beginPath(); g.moveTo(-34, 30); g.quadraticCurveTo(-44, -10, -10, -60 - k); g.quadraticCurveTo(0, -20, 14, -40 + k); g.quadraticCurveTo(44, -4, 34, 30); g.closePath(); F(g, P, '#ff7a2a'); g.beginPath(); g.moveTo(-16, 30); g.quadraticCurveTo(-20, 0, 0, -26 + k); g.quadraticCurveTo(22, 4, 16, 30); g.closePath(); F(g, P, '#ffd35a'); } },
  drop: { ground: false, h: 70, draw(g, P, t, o) { g.beginPath(); g.moveTo(0, -36); g.quadraticCurveTo(30, 6, 0, 30); g.quadraticCurveTo(-30, 6, 0, -36); F(g, P, o.color || '#5fb6ff'); } },
  snowflake: { ground: false, h: 70, draw(g, P) { for (let i = 0; i < 3; i++) { g.save(); g.rotate(i * Math.PI / 3); line(g, '#dff2ff', 5, [0, -32, 0, 32]); line(g, '#dff2ff', 4, [-8, -22, 0, -14, 8, -22]); line(g, '#dff2ff', 4, [-8, 22, 0, 14, 8, 22]); g.restore(); } } },
  question: { ground: false, h: 90, draw(g, P, t, o) { text(g, '?', 0, 0, 96, o.color || P.ui.gold, 900); } },
  exclaim: { ground: false, h: 90, draw(g, P, t, o) { text(g, '!', 0, 0, 96, o.color || P.ui.hot, 900); } },
  zzz: { ground: false, h: 80, draw(g, P, t) { for (let i = 0; i < 3; i++) { const k = (t * 0.6 + i / 3) % 1; g.globalAlpha = 1 - k; text(g, 'z', 12 * i + k * 20, -k * 50 + 20 - i * 18, 26 + i * 8, P.ui.text, 800); } g.globalAlpha = 1; } },
  check: { ground: false, h: 80, draw(g, P) { C(g, P, '#3fbf6a', 0, 0, 36); line(g, '#ffffff', 9, [-16, 0, -4, 14, 18, -12]); } },
  cross: { ground: false, h: 80, draw(g, P) { C(g, P, '#e2463a', 0, 0, 36); line(g, '#ffffff', 9, [-14, -14, 14, 14]); line(g, '#ffffff', 9, [14, -14, -14, 14]); } },
  arrow: { ground: false, h: 60, draw(g, P, t, o) { poly(g, P, o.color || P.ui.gold, [-50, -12, 14, -12, 14, -30, 52, 0, 14, 30, 14, 12, -50, 12]); } },
  flag: { ground: true, draw(g, P, t, o) { line(g, P.propDark, 6, [0, 0, 0, -170]); const w = Math.sin(t * 4) * 6; g.beginPath(); g.moveTo(0, -168); g.quadraticCurveTo(40, -178 + w, 80, -160); g.lineTo(80, -116); g.quadraticCurveTo(40, -134 - w, 0, -124); g.closePath(); F(g, P, o.color || P.ui.hot); } },
  crown: { ground: false, h: 60, draw(g, P) { poly(g, P, '#f2c14e', [-40, 24, -44, -24, -20, 0, 0, -34, 20, 0, 44, -24, 40, 24]); } },
  bomb: { ground: false, h: 90, draw(g, P, t) { C(g, P, '#2a2a33', 0, 10, 34); R(g, P, '#444', -8, -32, 16, 12, 2); line(g, '#c89a5a', 4, [0, -32, 10, -46, 20, -50]); if (!P.outline) glow(g, 22, -52, 30, '#ffb13c', 0.8); C(g, P, '#ffd35a', 22, -52, 4 + Math.sin(t * 30) * 2); } },
  skull: { ground: false, h: 80, draw(g, P) { C(g, P, '#f1ede4', 0, -6, 32); R(g, P, '#f1ede4', -18, 14, 36, 20, 4); C(g, P, '#2a2a33', -12, -6, 9); C(g, P, '#2a2a33', 12, -6, 9); } },
  ghost: { ground: false, h: 100, draw(g, P, t) { g.translate(0, Math.sin(t * 2) * 6); g.beginPath(); g.moveTo(-34, 40); g.lineTo(-34, -10); g.arc(0, -10, 34, Math.PI, TAU); g.lineTo(34, 40); for (let i = 0; i < 4; i++) g.lineTo(34 - (i + 0.5) * 17, 30 + (i % 2) * 10); g.closePath(); F(g, P, 'rgba(240,244,255,0.9)'); C(g, P, '#2a2a33', -11, -10, 6); C(g, P, '#2a2a33', 11, -10, 6); } },
  speech: { ground: false, h: 80, draw(g, P, t, o) { R(g, P, '#ffffff', -70, -40, 140, 70, 24); poly(g, P, '#ffffff', [-30, 26, -46, 50, -6, 28]); if (o.text) boxText(g, o.text, 0, -5, 136, 62, 24, '#22222a'); } },
  thought: { ground: false, h: 90, draw(g, P, t, o) { if (o.outline) { const ink = o.color || P.outline || '#ffffff', bg = o.fill || P.look?.figure?.headFill || '#22403a', blobs = [[-24, -10, 30], [16, -16, 36], [44, 0, 24]]; g.strokeStyle = ink; g.lineWidth = 3.5; for (const [x, y, r] of blobs) { circle(g, x, y, r); g.stroke(); } g.fillStyle = bg; for (const [x, y, r] of blobs) { circle(g, x, y, r - 1.7); g.fill(); } for (const [x, y, r] of [[-40, 34, 8], [-52, 50, 5]]) { circle(g, x, y, r); g.stroke(); } if (o.text) boxText(g, o.text, 8, -6, 104, 58, 22, o.textColor || ink); return; } const bg = o.fill || '#ffffff'; C(g, P, bg, -24, -10, 30); C(g, P, bg, 16, -16, 36); C(g, P, bg, 44, 0, 24); C(g, P, bg, -40, 34, 8); C(g, P, bg, -52, 50, 5); if (o.text) boxText(g, o.text, 8, -6, 104, 58, 22, o.textColor || '#22222a'); } },
  chart: { ground: false, h: 120, draw(g, P, t, o) { R(g, P, P.ui.panel, -90, -60, 180, 120, 10); const v = o.values || [3, 5, 4, 8]; const mx = Math.max(...v); v.forEach((x, i) => R(g, P, i === v.length - 1 ? P.ui.gold : P.ui.cool, -70 + i * (140 / v.length), 46 - (x / mx) * 90, 140 / v.length - 10, (x / mx) * 90, 3)); } },
  target: { ground: false, h: 100, draw(g, P) { C(g, P, '#e2463a', 0, 0, 46); C(g, P, '#ffffff', 0, 0, 34); C(g, P, '#e2463a', 0, 0, 22); C(g, P, '#ffffff', 0, 0, 10); } },
  shield: { ground: false, h: 100, draw(g, P, t, o) { g.beginPath(); g.moveTo(0, -48); g.lineTo(40, -32); g.quadraticCurveTo(40, 26, 0, 48); g.quadraticCurveTo(-40, 26, -40, -32); g.closePath(); F(g, P, o.color || P.ui.cool); line(g, '#ffffff', 7, [-14, 0, -2, 12, 18, -12]); } },
  battery: { ground: false, h: 60, draw(g, P, t, o) { const lv = o.level ?? 0.3; R(g, P, P.propDark, -44, -22, 82, 44, 6); R(g, P, P.propDark, 38, -9, 8, 18, 2); R(g, P, lv < 0.25 ? '#e2463a' : '#3fbf6a', -38, -16, 70 * lv, 32, 3); } },
  wifi: { ground: false, h: 70, draw(g, P, t, o) { g.strokeStyle = o.color || P.ui.cool; g.lineCap = 'round'; for (let i = 1; i <= 3; i++) { g.lineWidth = 8; g.beginPath(); g.arc(0, 24, i * 18, -Math.PI * 0.78, -Math.PI * 0.22); g.stroke(); } C(g, P, o.color || P.ui.cool, 0, 24, 6); } },
  bell: { ground: false, h: 80, draw(g, P, t) { g.rotate(Math.sin(t * 9) * 0.2); g.beginPath(); g.moveTo(-34, 22); g.quadraticCurveTo(-30, -38, 0, -38); g.quadraticCurveTo(30, -38, 34, 22); g.closePath(); F(g, P, P.ui.gold); C(g, P, P.ui.gold, 0, 28, 8); } },
  dollar: { ground: false, h: 90, draw(g, P, t, o) { text(g, '$', 0, 0, 100, o.color || '#5fd06a', 900); } },
  percent: { ground: false, h: 90, draw(g, P, t, o) { text(g, '%', 0, 0, 96, o.color || P.ui.gold, 900); } },
};

// The story props: new ones, and hand-drawn versions of some of the above.
for (const [id, def] of Object.entries(drawnProps(PROPS, { boxText }))) PROPS[id] = def;

export const PROP_IDS = Object.keys(PROPS);

// ---------- staging geometry ----------
// In prop units (before size, the prop's own k and the stage's prop scale).
// box: [width, height] of the drawing. Ground props stand on their bottom-centre;
// floating props are centred on their origin.
// surface: where a figure can stand or sit. top = height above the floor,
// x0..x1 = horizontal extent (for an unflipped prop), ramp = optional slope length
// outside each end (a figure walking on rises gradually instead of stepping up).
const GEOMETRY = {
  bridge: { box: [340, 115], surface: { top: 70, x0: -170, x1: 170, ramp: 40 } },
  table: { box: [160, 86], surface: { top: 82, x0: -76, x1: 76 } },
  couch: { box: [244, 90], surface: { top: 52, x0: -100, x1: 100 } },
  chair: { box: [60, 100], surface: { top: 44, x0: -26, x1: 26 } },
  stool: { box: [52, 53], surface: { top: 50, x0: -26, x1: 26 } },
  bench: { box: [180, 96], surface: { top: 52, x0: -90, x1: 90 } },
  desk: { box: [180, 78], surface: { top: 78, x0: -90, x1: 90 } },
  bed: { box: [256, 96], surface: { top: 56, x0: -116, x1: 116 } },
  counter: { box: [272, 92], surface: { top: 92, x0: -136, x1: 136 } },
  rock: { box: [124, 56], surface: { top: 50, x0: -40, x1: 40, ramp: 20 } },
  box: { box: [92, 76], surface: { top: 76, x0: -46, x1: 46 } },
  chest: { box: [120, 85], surface: { top: 70, x0: -50, x1: 50 } },
  podium: { box: [100, 122] },
  boat: { box: [220, 190], surface: { top: 30, x0: -80, x1: 80 } },
  bike: { box: [150, 90], surface: { top: 80, x0: -30, x1: -8 } },
  car: { box: [220, 96] },
  bus: { box: [340, 140] },
  sign: { box: [160, 200] },
  door: { box: [92, 200] },
  fridge: { box: [80, 190] },
  bookshelf: { box: [120, 200] },
  lamp: { box: [56, 172] },
  streetlamp: { box: [60, 260] },
  tree: { box: [232, 240] },
  pine: { box: [140, 210] },
  house: { box: [260, 240] },
  building: { box: [180, 400] },
  tent: { box: [200, 120] },
  flag: { box: [80, 170] },
  campfire: { box: [70, 70] },
  // wide floating props
  board: { box: [300, 180] }, whiteboard: { box: [240, 156] }, tv: { box: [220, 132] }, plane: { box: [240, 100] },
  chart: { box: [180, 120] }, speech: { box: [140, 90] }, thought: { box: [150, 110] }, window: { box: [168, 188] },
  wings: { box: [220, 90] }, notebook: { box: [92, 70] }, rocket: { box: [112, 200] },
};

Object.assign(GEOMETRY, DRAWN_GEOMETRY);

// Size of a prop's drawing in prop units: {w, h}. Ground props default to 120 x 120.
export function propBox(type) {
  const g = GEOMETRY[type], def = PROPS[type];
  if (g?.box) return { w: g.box[0], h: g.box[1] };
  const h = def && !def.ground && def.h ? def.h : 120;
  return { w: h, h };
}

// The standing / sitting surface of a prop, mirrored when the prop is flipped (or null).
export function propSurface(type, flip = false) {
  const s = GEOMETRY[type]?.surface;
  if (!s) return null;
  return flip ? { ...s, x0: -s.x1, x1: -s.x0 } : { ...s };
}
export const SURFACE_PROPS = Object.keys(GEOMETRY).filter((k) => GEOMETRY[k].surface);

// Draw prop at (x, y). For ground props y is the floor; for icons it is the centre.
export function drawProp(g, type, x, y, size, P, t, opts = {}) {
  const def = PROPS[type];
  if (!def) return false;
  g.save();
  g.translate(x, y);
  if (opts.flip) g.scale(-size, size); else g.scale(size, size);
  if (opts.rot) g.rotate(opts.rot);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  def.draw(g, P, t, opts);
  g.restore();
  return true;
}

export const isGroundProp = (type) => !!PROPS[type]?.ground;
