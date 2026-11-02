// Atmosphere and screen effects plus the final colour grade.
import { clamp, lerp, css, mix, shade, glow, circle, ellipse, rng, noise1, TAU } from './util.js';
import { drawProp } from './props.js';

export const FX = {
  dust: 'floating dust motes in the light (indoors)',
  rain: 'rain streaks',
  snow: 'falling snow',
  sparkles: 'twinkling sparkles (magic, wonder, success)',
  confetti: 'falling confetti (celebration)',
  hearts: 'floating hearts (love, kindness)',
  bubbles: 'rising bubbles (underwater, dreamy)',
  embers: 'rising embers (fire, anger, intensity)',
  money: 'falling banknotes (wealth)',
  leaves: 'falling leaves (autumn, time passing)',
  fireflies: 'glowing fireflies (night, calm)',
  stars: 'twinkling star field over the scene',
  speedlines: 'horizontal speed streaks (fast motion)',
  zoomlines: 'radial burst lines (shock, realisation)',
  freeze: 'TIME STOPS at this moment: world frozen, cool tint, only the hero moves',
  flash: 'white flash at the start (impact, big reveal)',
  shake: 'camera shake (impact, explosion, panic)',
  spotlight: 'darken everything except a pool of light on the hero',
  heartbeat: 'pulsing red edges (danger, adrenaline)',
  glitch: 'digital glitch slices (tech, malfunction)',
  lightning: 'lightning flashes (storm, sudden idea)',
  fog: 'drifting fog bands (mystery)',
  godrays: 'light beams from the key light',
  dream: 'soft hazy glow (memory, dream, imagination)',
  night: 'darken the scene (lights out)',
  crowd: 'a row of background people',
};
export const FX_IDS = Object.keys(FX);

// Particles are fully deterministic from (seed, index, time).
export function drawParticles(g, kind, t, V, seed = 1, density = 1, clear = null) {
  const { W, H, P } = V;
  const S = Math.min(W, H) / 1080;
  const r = rng(seed * 31 + kind.length);
  const n = Math.round((kind === 'rain' ? 140 : kind === 'stars' ? 90 : kind === 'dust' ? 50 : 46) * density);
  g.save();
  for (let i = 0; i < n; i++) {
    const a = r(), b = r(), c = r(), d = r();
    switch (kind) {
      case 'dust': {
        const x = ((a * W * 1.3 + t * (6 + c * 14)) % (W * 1.3)) - W * 0.15;
        const y = b * H * 0.85 + Math.sin(t * 0.6 + i) * 14 * S;
        g.fillStyle = css(P.key, 0.25 + 0.45 * Math.abs(Math.sin(t * (0.5 + d) + i)));
        circle(g, x, y, (1.5 + c * 2.5) * S); g.fill();
        break;
      }
      case 'rain': {
        const sp = 1400 + c * 600;
        const x = ((a * W * 1.4 - t * 260) % (W * 1.4) + W * 1.4) % (W * 1.4) - W * 0.2;
        const y = ((b * H + t * sp) % (H * 1.2)) - H * 0.1;
        g.strokeStyle = css(mix(P.skyBot, '#cfe6ff', 0.6), 0.35 + d * 0.3); g.lineWidth = 2 * S;
        let yEnd = y + 46 * S;
        if (clear && clear.length) {
          // a dry zone: streaks stop on its top edge, and it keeps a slanted rain shadow below
          let cut = false;
          for (const z of clear) {
            if (yEnd < z.y0 || y > z.y1) continue;
            const atTop = y > z.y0 ? x + (y - z.y0) * 0.2 : x - (z.y0 - y) * 0.2;
            if (atTop < z.x0 || atTop > z.x1) continue;
            if (y >= z.y0) cut = true; else yEnd = Math.min(yEnd, z.y0);
          }
          if (cut) break;
        }
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - (yEnd - y) * (10 / 46), yEnd); g.stroke();
        break;
      }
      case 'snow': {
        const y = ((b * H * 1.2 + t * (60 + c * 60)) % (H * 1.2)) - H * 0.1;
        const x = a * W + Math.sin(t * (0.6 + d) + i) * 30 * S;
        g.fillStyle = css('#ffffff', 0.6 + d * 0.4); circle(g, x, y, (3 + c * 5) * S); g.fill();
        break;
      }
      case 'sparkles':
      case 'stars': {
        const x = a * W, y = (kind === 'stars' ? b * 0.7 : b) * H;
        const k = Math.max(0, Math.sin(t * (1.5 + c * 3) + i * 1.7));
        if (k < 0.2) break;
        const s = (kind === 'stars' ? 6 : 14) * S * k * (0.6 + d);
        g.fillStyle = css(kind === 'stars' ? '#ffffff' : P.ui.gold, k);
        g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.25, y - s * 0.25); g.lineTo(x + s, y); g.lineTo(x + s * 0.25, y + s * 0.25); g.lineTo(x, y + s); g.lineTo(x - s * 0.25, y + s * 0.25); g.lineTo(x - s, y); g.lineTo(x - s * 0.25, y - s * 0.25); g.fill();
        break;
      }
      case 'confetti': {
        const y = ((b * H * 1.3 + t * (180 + c * 160)) % (H * 1.3)) - H * 0.2;
        const x = a * W + Math.sin(t * 2 + i) * 40 * S;
        const cols = [P.ui.hot, P.ui.gold, P.ui.cool, '#7dff9a', '#ff9ad6'];
        g.save(); g.translate(x, y); g.rotate(t * (2 + d * 4) + i); g.scale(1, Math.cos(t * 5 + i));
        g.fillStyle = css(cols[i % cols.length]); g.fillRect(-7 * S, -4 * S, 14 * S, 8 * S); g.restore();
        break;
      }
      case 'hearts':
      case 'bubbles':
      case 'embers':
      case 'fireflies': {
        const rise = kind === 'fireflies' ? 10 : kind === 'embers' ? 120 : 70;
        const y = H * 1.1 - ((b * H * 1.2 + t * rise * (0.6 + c)) % (H * 1.2));
        const x = a * W + Math.sin(t * (0.8 + d) + i) * 30 * S;
        if (kind === 'hearts') { if (i % 3) break; g.globalAlpha = 0.85; drawProp(g, 'heart', x, y, (0.35 + c * 0.3) * S, P, t, { color: P.ui.hot }); g.globalAlpha = 1; }
        else if (kind === 'bubbles') { g.strokeStyle = css('#e8fbff', 0.6); g.lineWidth = 2 * S; circle(g, x, y, (5 + c * 10) * S); g.stroke(); }
        else if (kind === 'embers') { g.fillStyle = css(mix('#ff7a2a', '#ffd35a', d), 0.8); circle(g, x, y, (2 + c * 3) * S); g.fill(); }
        else { const k = 0.5 + 0.5 * Math.sin(t * 3 + i * 2); if (!P.outline) glow(g, x, y, 22 * S, '#d9ff7a', 0.6 * k); g.fillStyle = css('#f0ffb0', k); circle(g, x, y, 3 * S); g.fill(); }
        break;
      }
      case 'money':
      case 'leaves': {
        if (i % 2) break;
        const y = ((b * H * 1.3 + t * (90 + c * 70)) % (H * 1.3)) - H * 0.2;
        const x = a * W + Math.sin(t * 1.4 + i) * 60 * S;
        g.save(); g.translate(x, y); g.rotate(Math.sin(t * 2 + i) * 0.8);
        if (kind === 'money') { g.fillStyle = '#5fb86a'; g.fillRect(-26 * S, -12 * S, 52 * S, 24 * S); g.fillStyle = '#3f8a4a'; circle(g, 0, 0, 7 * S); g.fill(); }
        else { g.fillStyle = css([P.ui.hot, P.ui.gold, '#c8641e'][i % 3]); ellipse(g, 0, 0, 14 * S, 7 * S); g.fill(); }
        g.restore();
        break;
      }
      default: break;
    }
  }
  g.restore();
}

// Lighting-type screen effects ease in when they are cued mid-shot (info.age = seconds since
// the cue) and ease out after their end (info.left = seconds until the end, negative after it).
// Lightning, glitch and the rest stay instant.
export const EASED_SCREEN_FX = new Set(['spotlight', 'night', 'fog', 'godrays', 'dream']);
export const SCREEN_FX_EASE = 0.35;

export function screenFxFade(kind, info = {}) {
  if (!EASED_SCREEN_FX.has(kind)) return 1;
  let k = 1;
  if (typeof info.age === 'number') k = Math.min(k, clamp(info.age / SCREEN_FX_EASE));
  if (typeof info.left === 'number' && info.left < 0) k = Math.min(k, clamp(1 + info.left / SCREEN_FX_EASE));
  return k * k * (3 - 2 * k);
}

export function drawScreenFx(g, kind, lt, V, info = {}) {
  const fade = screenFxFade(kind, info);
  if (fade <= 0) return;
  if (fade < 1) {
    g.save();
    g.globalAlpha *= fade;
    drawScreenFxRaw(g, kind, lt, V, info);
    g.restore();
    return;
  }
  drawScreenFxRaw(g, kind, lt, V, info);
}

function drawScreenFxRaw(g, kind, lt, V, info) {
  const { W, H, P } = V;
  const S = Math.min(W, H) / 1080;
  switch (kind) {
    case 'speedlines': {
      const r = rng(5);
      g.save();
      for (let i = 0; i < 40; i++) {
        const y = r() * H, len = (200 + r() * 500) * S, sp = 3000 + r() * 2000;
        const x = W - ((r() * W * 2 + lt * sp) % (W * 2));
        g.strokeStyle = css('#ffffff', 0.15 + r() * 0.3); g.lineWidth = (2 + r() * 4) * S;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y); g.stroke();
      }
      g.restore();
      break;
    }
    case 'zoomlines': {
      const r = rng(9);
      const cx = (info.cx ?? 0.5) * W, cy = (info.cy ?? 0.45) * H;
      g.save();
      g.fillStyle = css('#ffffff', 0.18);
      for (let i = 0; i < 70; i++) {
        const a = r() * TAU, w = 0.006 + r() * 0.012, k = 0.92 + 0.08 * Math.sin(lt * 20 + i);
        const r0 = Math.max(W, H) * (0.32 + r() * 0.12) * k, r1 = Math.max(W, H);
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a - w) * r1, cy + Math.sin(a - w) * r1);
        g.lineTo(cx + Math.cos(a + w) * r1, cy + Math.sin(a + w) * r1);
        g.fill();
      }
      g.restore();
      break;
    }
    case 'spotlight': {
      const cx = info.x ?? W / 2, cy = info.y ?? H * 0.55;
      const gr = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.12, cx, cy, Math.min(W, H) * 0.55);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.78)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      break;
    }
    case 'heartbeat': {
      const k = Math.pow(Math.max(0, Math.sin(lt * 7)), 6);
      const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      gr.addColorStop(0, 'rgba(255,0,40,0)'); gr.addColorStop(1, css('#ff1e3c', 0.25 + k * 0.35));
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      break;
    }
    case 'night': {
      g.fillStyle = 'rgba(5,8,25,0.45)'; g.fillRect(0, 0, W, H);
      break;
    }
    case 'dream': {
      g.save(); g.globalCompositeOperation = 'screen';
      const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
      gr.addColorStop(0, 'rgba(255,240,255,0.0)'); gr.addColorStop(1, 'rgba(255,230,250,0.35)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
      break;
    }
    case 'fog': {
      g.save();
      for (let i = 0; i < 4; i++) {
        const y = H * (0.45 + i * 0.13), x = ((lt * (20 + i * 12)) % W) - W;
        const gr = g.createLinearGradient(0, y - 80 * S, 0, y + 80 * S);
        gr.addColorStop(0, css(P.skyBot, 0)); gr.addColorStop(0.5, css(mix(P.skyBot, '#ffffff', 0.4), 0.18)); gr.addColorStop(1, css(P.skyBot, 0));
        g.fillStyle = gr; g.fillRect(x, y - 80 * S, W * 3, 160 * S);
      }
      g.restore();
      break;
    }
    case 'godrays': {
      if (P.outline) break;
      const kx = info.kx ?? W * 0.7, ky = info.ky ?? H * 0.2;
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * 0.5 + (i - 3) * 0.16 + Math.sin(lt * 0.3 + i) * 0.02 + (kx > W / 2 ? 0.35 : -0.35);
        g.fillStyle = css(P.key, 0.05);
        g.beginPath(); g.moveTo(kx, ky);
        g.lineTo(kx + Math.cos(a - 0.05) * H * 2, ky + Math.sin(a - 0.05) * H * 2);
        g.lineTo(kx + Math.cos(a + 0.05) * H * 2, ky + Math.sin(a + 0.05) * H * 2);
        g.fill();
      }
      g.restore();
      break;
    }
    case 'lightning': {
      // the flash fires on its cue, then every 3.2 s
      const ph = (info.age != null ? Math.max(0, info.age) : lt) % 3.2;
      if (ph < 0.08 || (ph > 0.16 && ph < 0.22)) { g.fillStyle = 'rgba(230,240,255,0.55)'; g.fillRect(0, 0, W, H); }
      break;
    }
    case 'glitch': {
      const step = Math.floor(lt * 12);
      if (noise1(step, 4) > 0.55) {
        const src = g.canvas;
        for (let i = 0; i < 6; i++) {
          const y = noise1(step * 7 + i, 1) * H, h = (10 + noise1(step + i, 2) * 60) * S, dx = (noise1(step * 3 + i, 3) - 0.5) * 80 * S;
          try { g.drawImage(src, 0, y * (src.height / H), src.width, h * (src.height / H), dx, y, W, h); } catch { /* canvas not readable */ }
        }
        g.fillStyle = css(P.ui.cool, 0.08); g.fillRect(0, 0, W, H);
      }
      break;
    }
    default: break;
  }
}

// Freeze-frame look: cool desaturating tint with a soft edge.
export function drawFreezeTint(g, V, k) {
  const { W, H } = V;
  g.save();
  g.globalCompositeOperation = 'saturation';
  g.fillStyle = css('#808080', 0.55 * k);
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = css('#7fc8ff', 0.12 * k);
  g.fillRect(0, 0, W, H);
  g.restore();
}

let grainTiles = null;
function getGrain(env) {
  if (grainTiles || !env.createCanvas) return grainTiles;
  grainTiles = [];
  for (let k = 0; k < 4; k++) {
    const c = env.createCanvas(256, 256);
    const x = c.getContext('2d');
    const img = x.createImageData(256, 256);
    const r = rng(1000 + k);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (r() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    grainTiles.push(c);
  }
  return grainTiles;
}

export function drawGrade(g, V, look, t, env) {
  const { W, H } = V;
  const gr = look.grade || {};
  if (gr.tintA) {
    g.save(); g.globalCompositeOperation = 'soft-light';
    g.fillStyle = css(gr.tint, gr.tintA * 4); g.fillRect(0, 0, W, H);
    g.restore();
  }
  if (gr.vignette) {
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${gr.vignette})`);
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }
  if (gr.grain) {
    const tiles = getGrain(env);
    if (tiles) {
      const tile = tiles[Math.floor(t * 24) % tiles.length];
      g.save(); g.globalAlpha = gr.grain; g.globalCompositeOperation = 'overlay';
      const pat = g.createPattern(tile, 'repeat');
      g.fillStyle = pat;
      const ox = (Math.floor(t * 24) * 73) % 256, oy = (Math.floor(t * 24) * 131) % 256;
      g.translate(-ox, -oy); g.fillRect(0, 0, W + 256, H + 256);
      g.restore();
    }
  }
}
