// ffmpeg discovery and small audio helpers.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let cached = null;

export function findFfmpeg() {
  if (cached) return cached;
  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try { const p = require('ffmpeg-static'); if (p) candidates.push(p); } catch { /* optional */ }
  candidates.push('ffmpeg');
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['-version'], { encoding: 'utf8', timeout: 8000 });
      if (r.status === 0) {
        cached = { path: c, version: (r.stdout.split('\n')[0] || '').replace('ffmpeg version ', '').split(' ')[0] };
        return cached;
      }
    } catch { /* try next */ }
  }
  return null;
}

export function ffmpegPath() {
  const f = findFfmpeg();
  if (!f) throw new Error('ffmpeg was not found. Install it (see the README) or set FFMPEG_PATH, then restart Stickframe.');
  return f.path;
}

export function run(args, { onStderr, input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { const s = d.toString(); err = (err + s).slice(-6000); onStderr && onStderr(s); });
    p.stdout.on('data', () => {});
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err.split('\n').slice(-6).join(' ')}`))));
    if (input) { p.stdin.end(input); }
  });
}

export function probeDuration(file) {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr || '');
  if (!m) throw new Error('Could not read that audio file. Is it a valid audio format?');
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

// Decode any audio file to mono float32 PCM at the given rate.
export function decodePcm(file, rate = 16000) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('Could not decode audio: ' + err.slice(-300)));
      const buf = Buffer.concat(chunks);
      const out = new Float32Array(buf.length / 4);
      // Float files can hold wild samples (some TTS tools end on one). A single one ruins speech recognition and the mix.
      for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, buf.readFloatLE(i * 4) || 0));
      resolve(out);
    });
  });
}

// Write interleaved float32 stereo (or mono) PCM as a WAV file.
export function writeWav(file, channels, rate) {
  const n = channels[0].length, ch = channels.length;
  const data = Buffer.alloc(n * ch * 4);
  let o = 0;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { data.writeFloatLE(channels[c][i], o); o += 4; }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * ch * 4, 28); h.writeUInt16LE(ch * 4, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
