// On-screen graphics drawn in screen space over the scene: titles, numbers,
// labels, charts, badges, captions.
import { clamp, lerp, ease, css, mix, shade, roundRect, circle, TAU } from './util.js';
import { drawProp, layoutText } from './props.js';

export const DISPLAY = '"Lilita One", "Arial Black", Impact, sans-serif';
export const BODY = '"Rubik", "Segoe UI", Arial, sans-serif';

export const OVERLAY_TYPES = {
  title: 'big glowing title text, optional "sub" line',
  big: 'one huge word or number that pops in (e.g. "96x", "$1M", "NO.")',
  counter: 'number that counts from "from" to "to" (use prefix/suffix/decimals); for any number the narrator says',
  label: 'small pill label; attach to an actor with "on" or place with x/y',
  badge: 'corner badge such as "DAY 3" or "10x"',
  bars: 'bar chart: items [{label, value}] growing in',
  line: 'line chart drawing on: values [..], optional label',
  meter: 'progress/level bar: value 0..1 and label',
  list: 'checklist: items [..] appearing one by one',
  vs: 'comparison: left vs right labels',
  question: 'large question/statement for endings or hooks',
  cta: 'call-to-action pill such as "Subscribe for part 2"',
  stamp: 'rotated stamp that slams in (e.g. "FAILED", "TRUE")',
  icon: 'a prop drawn huge in the centre as a graphic (use "prop")',
  timer: 'digital clock that counts (from/to seconds, mm:ss)',
};

// A look may swap the display face (looks.js "display"); set at the start of each overlay draw.
let display = DISPLAY;

function font(g, size, family = display, weight = '') {
  g.font = `${weight ? weight + ' ' : ''}${Math.round(size)}px ${family}`;
}

function fitText(g, str, size, maxW, family = display, weight = '') {
  font(g, size, family, weight);
  const w = g.measureText(str).width;
  if (w > maxW) { size *= maxW / w; font(g, size, family, weight); }
  return size;
}

function outlinedText(g, str, x, y, fill, stroke, lw, glowC) {
  g.lineJoin = 'round';
  if (stroke && lw) { g.strokeStyle = stroke; g.lineWidth = lw; g.strokeText(str, x, y); }
  if (glowC) { g.save(); g.shadowColor = glowC; g.shadowBlur = lw * 3; g.fillStyle = fill; g.fillText(str, x, y); g.restore(); }
  g.fillStyle = fill;
  g.fillText(str, x, y);
}

// Safe area: graphics keep this fraction of the frame clear on every side.
const SAFE = 0.05;
// Width available to text centred at cx without leaving the safe area (capped at cap).
function roomW(cx, W, cap) { return Math.max(W * 0.2, Math.min(cap, 2 * Math.min(cx - W * SAFE, W * (1 - SAFE) - cx))); }
// Keep a box of half-size `half` centred at v inside the safe area of a span of length L.
function keepIn(v, half, L) { const lo = L * SAFE + half, hi = L * (1 - SAFE) - half; return lo > hi ? L / 2 : clamp(v, lo, hi); }
// Line offsets for a laid-out block centred on 0.
const lineY = (L, i) => (i - (L.lines.length - 1) / 2) * L.lineHeight;
// Big display text: one line when it fits at >= 60% of the base size, otherwise up to two lines.
function displayLayout(g, str, base, boxW, family = display, weight = '') {
  const s = String(str);
  if (!/\n|\\n/.test(s)) {
    font(g, base, family, weight);
    const w = g.measureText(s).width;
    if (w <= boxW || !/\s/.test(s.trim()) || base * boxW / w >= base * 0.6) {
      const size = w > boxW ? base * boxW / w : base;
      font(g, size, family, weight);
      return { lines: [s], size, lineHeight: size * 1.05, width: Math.min(w, boxW), height: size * 1.05 };
    }
  }
  return layoutText(g, s, { w: boxW, h: base * 0.8 * 1.05 * 2 }, { maxSize: base * 0.8, minSize: base * 0.3, family, weight, lineHeight: 1.05, maxLines: 2 });
}

export function fmtNumber(v, o = {}) {
  const d = o.decimals ?? (Math.abs(o.to ?? v) < 10 && !Number.isInteger(o.to ?? v) ? 1 : 0);
  let s;
  if (o.format === 'time') {
    const sec = Math.max(0, Math.round(v));
    s = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  } else if (o.format === 'short' || (o.format !== 'full' && Math.abs(o.to ?? v) >= 1e6)) {
    const a = Math.abs(v);
    s = a >= 1e9 ? (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e4 ? Math.round(v / 1e3) + 'K' : Math.round(v).toLocaleString('en-US');
  } else {
    s = v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  return (o.prefix || '') + s + (o.suffix || '');
}

// Visibility envelope: pop in, hold, fade out.
function env(lt, o) {
  const a = lt - o._at;
  if (a < 0) return null;
  if (o._until != null && lt > o._until + 0.2) return null;
  if (typeof o.hardUntil === 'number' && lt >= o.hardUntil) return null;
  // enter: false shows it settled from its first frame (carrying a graphic across a cut)
  const inK = o.enter === false ? 1 : clamp(a / 0.35);
  const outK = o._until != null ? clamp((o._until + 0.2 - lt) / 0.2) : 1;
  return { a, inK, outK, alpha: o.enter === false ? outK : Math.min(clamp(a / 0.12), outK) };
}

export function drawOverlay(g, o, lt, V) {
  const e = env(lt, o);
  if (!e) return;
  const { W, H, P, vertical } = V;
  const ui = P.ui;
  display = P.look?.display || DISPLAY;
  const S = Math.min(W, H) / 1080;
  const accent = o.color || ui.gold;
  g.save();
  g.globalAlpha = e.alpha;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const x = (o.x ?? 0.5) * W;
  switch (o.type) {
    case 'title': {
      const y = (o.y ?? 0.42) * H;
      const k = ease.outBack(e.inK);
      g.translate(x, y); g.scale(lerp(0.6, 1, k), lerp(0.6, 1, k));
      const str = String(o.text || '').toUpperCase();
      const base = (vertical ? 120 : 130) * S * (o.size || 1);
      const L = layoutText(g, str, { w: roomW(x, W, W * (vertical ? 0.86 : 0.72)), h: base * 1.08 * 2 }, { maxSize: base, minSize: base * 0.4, family: display, weight: '', lineHeight: 1.08, maxLines: 2 });
      const size = L.size;
      L.lines.forEach((ln, i) => outlinedText(g, ln, 0, lineY(L, i), ui.text, ui.shadow, size * 0.12, css(accent, 0.8)));
      if (o.sub) { const s2 = fitText(g, String(o.sub), size * 0.36, roomW(x, W, W * 0.8), BODY, 600); g.globalAlpha = e.alpha * clamp((e.a - 0.3) / 0.3); outlinedText(g, String(o.sub), 0, L.height / 2 + size * 0.3, accent, ui.shadow, s2 * 0.15); }
      break;
    }
    case 'big':
    case 'stamp': {
      const isStamp = o.type === 'stamp';
      const str = String(o.text ?? '');
      const k = isStamp ? ease.out(e.inK) : ease.outBack(e.inK);
      const sc = isStamp ? lerp(2.2, 1, k) : lerp(0.3, 1, k);
      const base = (o.size || 1) * (vertical ? 190 : 200) * S;
      // A stamp adds a frame (+0.5 em) and is tilted, so its text gets a little less room.
      const L = displayLayout(g, str, base, roomW(x, W, W * 0.85) / (isStamp ? 1.25 : 1));
      const size = L.size;
      const bh = L.height - L.lineHeight + size * 1.2;
      const subH = o.sub ? size * 0.5 : 0;
      // Extents of the (tilted) block, so the settled graphic stays inside the safe area.
      const rot = isStamp ? 0.16 : 0, bw = L.width + (isStamp ? size * 0.5 : 0);
      const halfW = (bw / 2) * Math.cos(rot) + (bh / 2) * Math.sin(rot) + size * 0.04;
      const halfH = (bh / 2) * Math.cos(rot) + (bw / 2) * Math.sin(rot) + size * 0.04;
      const cx = keepIn(x, halfW, W);
      const y = keepIn((o.y ?? (isStamp ? 0.4 : 0.3)) * H, halfH + subH / 2, H) - subH / 2;
      g.translate(cx, y);
      if (isStamp) g.rotate(-0.16);
      g.scale(sc, sc);
      if (isStamp) {
        const w = L.width + size * 0.5;
        g.strokeStyle = o.color || ui.hot; g.lineWidth = size * 0.08;
        roundRect(g, -w / 2, -bh / 2 - size * 0.02, w, bh, size * 0.15); g.stroke();
        g.fillStyle = o.color || ui.hot;
        L.lines.forEach((ln, i) => g.fillText(ln, 0, lineY(L, i) + size * 0.04));
      } else L.lines.forEach((ln, i) => outlinedText(g, ln, 0, lineY(L, i), accent, ui.shadow, size * 0.1, css(accent, 0.6)));
      if (o.sub) { const sub = String(o.sub).toUpperCase(); const s2 = fitText(g, sub, size * 0.25, roomW(x, W, W * 0.8), BODY, 700); outlinedText(g, sub, 0, L.height / 2 + size * 0.2, ui.text, ui.shadow, s2 * 0.18); }
      break;
    }
    case 'counter':
    case 'timer': {
      const dur = o.dur ?? 1.2;
      const k = (o.ease === 'linear' ? clamp : ease.out)(clamp(e.a / dur));
      const from = Number(o.from ?? 0), to = Number(o.to ?? 0);
      const val = lerp(from, to, k);
      const str = fmtNumber(o.type === 'timer' ? val : (Number.isInteger(to) && Number.isInteger(from) && !o.decimals ? Math.round(val) : val), { ...o, format: o.type === 'timer' ? 'time' : o.format, to });
      const pop = ease.outBack(e.inK);
      const size = fitText(g, str, (o.size || 1) * (vertical ? 170 : 170) * S, roomW(x, W, W * 0.85));
      const top = size * 0.66, bottom = o.label ? size * 0.9 : size * 0.66;
      const yy = (o.y ?? 0.28) * H, lo = H * SAFE + top, hi = H * (1 - SAFE) - bottom;
      const y = lo > hi ? H / 2 : clamp(yy, lo, hi);
      g.translate(x, y); g.scale(lerp(0.5, 1, pop), lerp(0.5, 1, pop));
      if (o.type === 'timer') {
        const w = g.measureText(str).width + size * 0.6;
        g.fillStyle = ui.panel; roundRect(g, -w / 2, -size * 0.65, w, size * 1.3, size * 0.2); g.fill();
      }
      outlinedText(g, str, 0, 0, accent, ui.shadow, size * 0.1, css(accent, 0.55));
      if (o.label) { const s2 = fitText(g, String(o.label).toUpperCase(), size * 0.24, roomW(x, W, W * 0.8), BODY, 700); outlinedText(g, String(o.label).toUpperCase(), 0, size * 0.72, ui.text, ui.shadow, s2 * 0.18); }
      break;
    }
    case 'label': {
      let lx = x, ly = (o.y ?? 0.2) * H, ax = null, ay = null;
      if (o._anchor) { ax = o._anchor.x; ay = o._anchor.y; lx = ax + (o.dx ?? 0.08) * W * (ax > W * 0.6 ? -1 : 1); ly = ay - (o.dy ?? 0.1) * H; }
      const str = String(o.text || '').toUpperCase();
      const base = 44 * S * (o.size || 1);
      // Pills wrap at roughly 30 characters and grow to fit (up to 3 lines).
      const L = layoutText(g, str, { w: W * (vertical ? 0.7 : 0.42), h: base * 1.15 * 3 }, { maxSize: base, minSize: base * 0.6, family: BODY, weight: 800, lineHeight: 1.15, maxLines: 3 });
      const size = L.size;
      const w = L.width + size * 1.1, h = L.height - L.lineHeight + size * 1.6;
      lx = keepIn(lx, w / 2, W); ly = keepIn(ly, h / 2, H);
      const k = ease.outBack(e.inK);
      if (ax != null) {
        g.strokeStyle = css(accent); g.lineWidth = 4 * S;
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(lerp(ax, lx, k), lerp(ay, ly + h / 2, k)); g.stroke();
        g.fillStyle = css(accent); circle(g, ax, ay, 7 * S); g.fill();
      }
      g.translate(lx, ly); g.scale(k, k);
      g.fillStyle = ui.panel; roundRect(g, -w / 2, -h / 2, w, h, Math.min(h / 2, size * 0.8)); g.fill();
      g.strokeStyle = css(accent); g.lineWidth = 3 * S; g.stroke();
      g.fillStyle = o.textColor ? css(o.textColor) : ui.panelText;
      L.lines.forEach((ln, i) => g.fillText(ln, 0, lineY(L, i) + size * 0.05));
      break;
    }
    case 'badge': {
      const str = String(o.text || '').toUpperCase();
      const base = 54 * S * (o.size || 1);
      const L = layoutText(g, str, { w: W * (vertical ? 0.6 : 0.3), h: base * 1.1 * 2 }, { maxSize: base, minSize: base * 0.6, family: display, weight: '', lineHeight: 1.1, maxLines: 2 });
      const size = L.size;
      const w = L.width + size * 1.0, h = L.height - L.lineHeight + size * 1.5;
      const bx = keepIn((o.x ?? (vertical ? 0.5 : 0.86)) * W, w / 2 + 4 * S, W), by = keepIn((o.y ?? (vertical ? 0.1 : 0.12)) * H, h / 2 + 4 * S, H);
      const k = ease.outBack(e.inK);
      g.translate(bx, by); g.scale(k, k); g.rotate(-0.05);
      g.fillStyle = css(accent); roundRect(g, -w / 2, -h / 2, w, h, 12 * S); g.fill();
      g.fillStyle = mix(accent, '#000000', 0.75);
      L.lines.forEach((ln, i) => g.fillText(ln, 0, lineY(L, i) + size * 0.06));
      break;
    }
    case 'bars': {
      const items = (o.items || []).slice(0, 6);
      if (!items.length) break;
      const max = Math.max(...items.map((i) => Math.abs(Number(i.value) || 0)), 1e-9);
      const bw = vertical ? W * 0.8 : W * 0.56, bh = vertical ? H * 0.32 : H * 0.48;
      const cx = x, cy = (o.y ?? (vertical ? 0.3 : 0.42)) * H;
      const n = items.length, gap = bw / n;
      const labs = items.map((it) => layoutText(g, String(it.label || '').toUpperCase(), { w: gap * 0.7 * 1.3, h: 34 * S * 1.1 * 2 }, { maxSize: 34 * S, minSize: 24 * S, family: BODY, weight: 700, lineHeight: 1.1, maxLines: 2 }));
      const extra = Math.max(0, ...labs.map((L) => L.height - L.lineHeight));
      g.fillStyle = ui.panel; roundRect(g, cx - bw / 2 - 30 * S, cy - bh / 2 - 60 * S, bw + 60 * S, bh + 130 * S + extra, 26 * S); g.fill();
      if (o.title) { fitText(g, String(o.title).toUpperCase(), 40 * S, bw, BODY, 800); g.fillStyle = ui.panelText; g.fillText(String(o.title).toUpperCase(), cx, cy - bh / 2 - 22 * S); }
      items.forEach((it, i) => {
        const k = ease.out(clamp((e.a - i * 0.18) / 0.8));
        const v = Number(it.value) || 0;
        const h = (Math.abs(v) / max) * (bh - 60 * S) * k;
        const bx = cx - bw / 2 + gap * i + gap * 0.15, w = gap * 0.7, base = cy + bh / 2 - 10 * S;
        const c = it.color || (i === (o.highlight ?? items.findIndex((q) => Math.abs(Number(q.value)) === max)) ? accent : ui.cool);
        g.fillStyle = css(c); roundRect(g, bx, base - h, w, h, 8 * S); g.fill();
        font(g, 34 * S, display); g.fillStyle = ui.panelText;
        g.fillText(fmtNumber(v * k, { prefix: it.prefix ?? o.prefix, suffix: it.suffix ?? o.suffix, to: v, decimals: it.decimals }), bx + w / 2, base - h - 26 * S);
        const L = labs[i]; font(g, L.size, BODY, 700); g.fillStyle = ui.panelText;
        L.lines.forEach((ln, j) => g.fillText(ln, bx + w / 2, base + 34 * S + j * L.lineHeight));
      });
      break;
    }
    case 'line': {
      const vals = (o.values || [1, 2, 3]).map(Number);
      const bw = vertical ? W * 0.8 : W * 0.56, bh = vertical ? H * 0.25 : H * 0.42;
      const cx = x, cy = (o.y ?? (vertical ? 0.3 : 0.42)) * H;
      g.fillStyle = ui.panel; roundRect(g, cx - bw / 2 - 30 * S, cy - bh / 2 - 60 * S, bw + 60 * S, bh + 100 * S, 26 * S); g.fill();
      if (o.title) { font(g, 40 * S, BODY, 800); g.fillStyle = ui.panelText; g.fillText(String(o.title).toUpperCase(), cx, cy - bh / 2 - 22 * S); }
      const mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
      const pt = (i) => ({ x: cx - bw / 2 + (i / Math.max(1, vals.length - 1)) * bw, y: cy + bh / 2 - ((vals[i] - mn) / rg) * bh * 0.85 });
      const k = ease.inOut(clamp(e.a / (o.dur ?? 1.6))) * (vals.length - 1);
      g.strokeStyle = css(accent); g.lineWidth = 8 * S; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i <= Math.floor(k); i++) { const p = pt(i); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }
      const i0 = Math.floor(k), fr = k - i0;
      let tip = pt(i0);
      if (i0 < vals.length - 1) { const a = pt(i0), b = pt(i0 + 1); tip = { x: lerp(a.x, b.x, fr), y: lerp(a.y, b.y, fr) }; g.lineTo(tip.x, tip.y); }
      g.stroke();
      g.fillStyle = css(accent); circle(g, tip.x, tip.y, 12 * S); g.fill();
      if (o.label) { font(g, 36 * S, display); g.fillStyle = ui.panelText; g.fillText(String(o.label), tip.x, tip.y - 40 * S); }
      break;
    }
    case 'meter': {
      const v = clamp(Number(o.value ?? 0.5));
      const bw = vertical ? W * 0.76 : W * 0.46, bh = 54 * S;
      const x = keepIn((o.x ?? 0.5) * W, bw / 2 + 8 * S, W);
      const cy = Math.max(keepIn((o.y ?? 0.2) * H, bh / 2 + 8 * S, H), o.text || o.label ? H * SAFE + bh + 22 * S : 0);
      if (o.text || o.label) fitText(g, String(o.text || o.label).toUpperCase(), 40 * S, bw, BODY, 800);
      const k = ease.out(clamp(e.a / (o.dur ?? 1)));
      if (o.text || o.label) outlinedText(g, String(o.text || o.label).toUpperCase(), x, cy - bh, ui.text, ui.shadow, 8 * S);
      g.fillStyle = ui.panel; roundRect(g, x - bw / 2 - 8 * S, cy - bh / 2 - 8 * S, bw + 16 * S, bh + 16 * S, bh); g.fill();
      const c = o.color || (v < 0.25 ? ui.hot : v > 0.75 ? '#4fd66a' : ui.gold);
      const shown = o.from != null ? lerp(clamp(Number(o.from)), v, k) : v * k; // "from" lets a meter drain as well as fill
      g.fillStyle = css(c); roundRect(g, x - bw / 2, cy - bh / 2, Math.max(bh, bw * shown), bh, bh / 2); g.fill();
      break;
    }
    case 'list': {
      const items = (o.items || []).slice(0, 6).map(String);
      if (!items.length) break;
      const step = o.step ?? 0.6;
      const sc = o.size || 1;
      const lh = (vertical ? 90 : 78) * S * sc, fs = 44 * S * sc, ind = 48 * S * sc;
      const bwMax = vertical ? W * 0.76 : W * 0.38;
      // Long items wrap (2 lines max) with a hanging indent; the panel grows to fit.
      const Ls = items.map((it) => layoutText(g, it, { w: bwMax - 70 * S * sc, h: fs * 1.15 * 2 }, { maxSize: fs, minSize: fs * 0.6, family: BODY, weight: 700, lineHeight: 1.15, maxLines: 2 }));
      const rows = Ls.map((L) => lh + L.height - L.lineHeight);
      const total = rows.reduce((a, b) => a + b, 0);
      const bw = Math.min(bwMax, Math.max(bwMax * 0.45, Math.max(...Ls.map((L) => L.width)) + ind + 22 * S * sc));
      const x0 = clamp((o.x ?? (vertical ? 0.12 : 0.56)) * W, W * SAFE + 30 * S, W * (1 - SAFE) - bw - 30 * S);
      const y0 = clamp((o.y ?? (vertical ? 0.14 : 0.22)) * H, H * SAFE + 50 * S * sc, Math.max(H * SAFE + 50 * S * sc, H * (1 - SAFE) - total - 10 * S * sc));
      g.fillStyle = ui.panel; roundRect(g, x0 - 30 * S, y0 - 50 * S * sc, bw + 60 * S, total + 60 * S * sc, 24 * S); g.fill();
      g.textAlign = 'left';
      let y = y0;
      items.forEach((it, i) => {
        const k = clamp((e.a - i * step) / 0.3);
        const L = Ls[i];
        if (k > 0) {
          g.globalAlpha = e.alpha * k;
          g.fillStyle = css(accent); circle(g, x0 + 14 * S * sc, y, 16 * S * sc); g.fill();
          g.strokeStyle = mix(accent, '#000', 0.7); g.lineWidth = 5 * S * sc; g.beginPath(); g.moveTo(x0 + 6 * S * sc, y); g.lineTo(x0 + 12 * S * sc, y + 7 * S * sc); g.lineTo(x0 + 23 * S * sc, y - 7 * S * sc); g.stroke();
          font(g, L.size, BODY, 700);
          g.fillStyle = ui.panelText;
          L.lines.forEach((ln, j) => g.fillText(ln, x0 + ind + (1 - k) * 30, y + 2 * S + j * L.lineHeight));
        }
        y += rows[i];
      });
      break;
    }
    case 'vs': {
      const y = (o.y ?? 0.2) * H;
      const k = ease.outBack(e.inK);
      const L = String(o.left || '').toUpperCase(), Rt = String(o.right || '').toUpperCase();
      const size = 70 * S;
      fitText(g, L, size, W * 0.34);
      outlinedText(g, L, lerp(W * 0.1, W * 0.27, k), y, ui.cool, ui.shadow, size * 0.12);
      fitText(g, Rt, size, W * 0.34);
      outlinedText(g, Rt, lerp(W * 0.9, W * 0.73, k), y, ui.hot, ui.shadow, size * 0.12);
      font(g, size * 1.3 * k);
      outlinedText(g, 'VS', W / 2, y, ui.gold, ui.shadow, size * 0.14, css(ui.gold, 0.7));
      break;
    }
    case 'question': {
      const str = String(o.text || '');
      const base = (vertical ? 92 : 96) * S * (o.size || 1);
      const L = layoutText(g, str, { w: roomW(x, W, W * (vertical ? 0.84 : 0.72)), h: base * 1.15 * 3 }, { maxSize: base, minSize: base * 0.45, family: display, weight: '', lineHeight: 1.15, maxLines: 3 });
      const y = keepIn((o.y ?? (vertical ? 0.2 : 0.22)) * H, L.height / 2, H);
      g.translate(x, y + (1 - ease.out(e.inK)) * 40 * S);
      L.lines.forEach((ln, i) => outlinedText(g, ln, 0, lineY(L, i), ui.text, ui.shadow, L.size * 0.12, css(accent, 0.5)));
      break;
    }
    case 'cta': {
      const str = String(o.text || 'Subscribe').toUpperCase();
      const base = 46 * S * (o.size || 1);
      const L = layoutText(g, str, { w: W * (vertical ? 0.6 : 0.45), h: base * 1.12 * 2 }, { maxSize: base, minSize: base * 0.6, family: BODY, weight: 800, lineHeight: 1.12, maxLines: 2 });
      const size = L.size;
      const w = L.width + size * 2.6, h = L.height - L.lineHeight + size * 1.9;
      const cx = keepIn(x, w / 2, W), y = keepIn((o.y ?? 0.85) * H, h / 2, H);
      const k = ease.outBack(e.inK);
      g.translate(cx, y); g.scale(k, k);
      g.fillStyle = css(o.color || ui.hot); roundRect(g, -w / 2, -h / 2, w, h, Math.min(h / 2, size * 0.95)); g.fill();
      g.fillStyle = '#ffffff';
      L.lines.forEach((ln, i) => g.fillText(ln, size * 0.5, lineY(L, i) + size * 0.05));
      g.save(); g.translate(-w / 2 + size * 1.1, 0); g.rotate(Math.sin(e.a * 9) * 0.25 * Math.max(0, 1 - e.a / 2)); drawProp(g, 'bell', 0, 0, size / 70, { ...P, outline: null }, e.a, {}); g.restore();
      break;
    }
    case 'icon': {
      const y = (o.y ?? 0.4) * H;
      const k = ease.outBack(e.inK);
      const sz = (o.size || 2.4) * S * k;
      drawProp(g, o.prop || 'star', x, y, sz, P, lt, { color: o.color, text: o.text, beat: true });
      break;
    }
    default: break;
  }
  g.restore();
}

// Word-synced captions at the bottom (16:9) or lower-middle (9:16).
export function drawCaptions(g, chunks, t, V, style = {}) {
  const c = chunks.find((k) => t >= k.start && t < k.end + 0.15);
  if (!c) return;
  const { W, H, P, vertical } = V;
  display = P.look?.display || DISPLAY;
  const S = Math.min(W, H) / 1080;
  const y = (vertical ? 0.76 : 0.88) * H;
  let size = (vertical ? 76 : 62) * S;
  g.save();
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  font(g, size);
  const parts = c.words.map((w) => ({ ...w, s: String(w.text).trim().toUpperCase() }));
  const spaceK = 0.42;
  let space = size * spaceK;
  let total = parts.reduce((a, p) => a + g.measureText(p.s).width, 0) + space * (parts.length - 1);
  const maxW = W * (vertical ? 0.86 : 0.8);
  if (total > maxW) { size *= maxW / total; font(g, size); space = size * spaceK; total = parts.reduce((a, p) => a + g.measureText(p.s).width, 0) + space * (parts.length - 1); }
  let xx = W / 2 - total / 2;
  const hi = style.highlight || P.ui.gold;
  let activeIdx = -1;
  parts.forEach((p, i) => { if (t >= p.start) activeIdx = i; });
  for (const [i, p] of parts.entries()) {
    const w = g.measureText(p.s).width;
    const active = i === activeIdx;
    const done = t >= p.start;
    const pop = active ? 1 + 0.12 * Math.max(0, 1 - (t - p.start) / 0.15) : 1;
    g.save();
    g.translate(xx + w / 2, y);
    g.scale(pop, pop);
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.lineWidth = size * 0.2;
    g.strokeText(p.s, -w / 2, 0);
    g.fillStyle = active ? hi : done ? '#ffffff' : 'rgba(255,255,255,0.85)';
    g.fillText(p.s, -w / 2, 0);
    g.restore();
    xx += w + space;
  }
  g.restore();
}

// Split words into short caption chunks (max ~4-5 words, break on punctuation and pauses).
export function buildCaptionChunks(words, maxWords = 4) {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) { out.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur }); cur = []; } };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > 0.4)) flush();
    cur.push(w);
    if (/[.!?,;:]$/.test(String(w.text).trim()) || cur.length >= maxWords) flush();
  }
  flush();
  for (let i = 0; i < out.length - 1; i++) out[i].end = Math.min(out[i].end + 0.25, out[i + 1].start);
  return out;
}
