// Video export. The timeline is split into contiguous chunks rendered in parallel
// worker threads (each pipes raw frames into its own ffmpeg), then the chunks are
// joined and muxed with the mixed audio.
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, ffmpegPath } from './media.js';
import { mixAudio } from './audio.js';
import { compileFilm } from '../engine/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const RESOLUTIONS = { '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160 };

export function outputSize(aspect, resolution, scale = 1) {
  const short = (RESOLUTIONS[resolution] || 1080) * scale;
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return aspect === '9:16' ? { width: even(short), height: even((short * 16) / 9) } : { width: even((short * 16) / 9), height: even(short) };
}

// job: { project, words, out, from, to, scale, onProgress, signal }
export async function renderVideo(job) {
  const p = job.project;
  const fps = p.fps || 30;
  const meta = { aspect: p.aspect, words: job.words, look: p.look, captions: p.captions, duration: job.duration };
  const film = compileFilm(p.storyboard, meta);
  const from = Math.max(0, job.from ?? 0);
  const to = Math.min(film.duration, job.to ?? film.duration);
  const { width, height } = outputSize(p.aspect, p.resolution, job.scale || 1);
  const f0 = Math.floor(from * fps), f1 = Math.ceil(to * fps);
  const frames = Math.max(1, f1 - f0);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-render-'));
  const cpu = os.cpus().length;
  const nWorkers = Math.max(1, Math.min(job.workers || Math.max(1, Math.min(cpu - 1, 8)), Math.ceil(frames / 60)));
  const per = Math.ceil(frames / nWorkers);
  const progress = new Array(nWorkers).fill(0);
  const started = Date.now();
  const report = () => {
    const done = progress.reduce((a, b) => a + b, 0);
    const el = (Date.now() - started) / 1000;
    const fpsNow = done / Math.max(0.001, el);
    const eta = fpsNow > 0 ? (frames - done) / fpsNow : 0;
    job.onProgress?.(0.05 + 0.8 * (done / frames), `Rendering frame ${done}/${frames} · ${fpsNow.toFixed(1)} fps · ${Math.ceil(eta)}s left`);
  };
  job.onProgress?.(0.02, `Starting ${nWorkers} render worker${nWorkers > 1 ? 's' : ''} at ${width}×${height}`);
  const workers = [];
  const chunks = [];
  try {
    await Promise.all(Array.from({ length: nWorkers }, (_, i) => {
      const a = f0 + i * per, b = Math.min(f1, a + per);
      if (a >= b) return Promise.resolve();
      const file = path.join(workDir, `chunk${String(i).padStart(3, '0')}.mp4`);
      chunks.push(file);
      return new Promise((resolve, reject) => {
        const w = new Worker(path.join(here, 'render-worker.js'), {
          workerData: { story: p.storyboard, meta, look: p.look, width, height, fps, frameStart: a, frameEnd: b, file, ffmpeg: ffmpegPath(), crf: job.crf ?? 19, preset: job.preset || 'fast' },
        });
        workers.push(w);
        w.on('message', (m) => {
          if (m.type === 'progress') { progress[i] = m.done; report(); }
          if (m.type === 'done') resolve();
          if (m.type === 'error') reject(new Error(m.message));
        });
        w.on('error', reject);
        w.on('exit', (code) => { if (code !== 0) reject(new Error(`Render worker stopped (${code})`)); });
        job.signal?.addEventListener('abort', () => { w.terminate(); reject(new Error('Render cancelled')); });
      });
    }));
    chunks.sort();
    job.onProgress?.(0.86, 'Mixing audio');
    const wav = path.join(workDir, 'mix.wav');
    const dur = (f1 - f0) / fps;
    await mixAudio({
      out: wav,
      duration: film.duration,
      voiceFile: job.voiceFile,
      musicSections: p.storyboard.music,
      musicFile: job.musicFile,
      musicMode: p.music?.mode || 'auto',
      musicVolume: p.music?.volume ?? 0.5,
      sfx: film.sfx,
      sfxOn: p.sfx !== false,
      sfxLibrary: p.sfxLibrary,
      onProgress: (k, msg) => job.onProgress?.(0.86 + 0.06 * k, msg),
    });
    job.onProgress?.(0.93, 'Joining video and audio');
    const list = path.join(workDir, 'list.txt');
    fs.writeFileSync(list, chunks.map((c) => `file '${c.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    fs.mkdirSync(path.dirname(job.out), { recursive: true });
    // Master: one static gain to the loudness target, measured on the mix first. A one-pass dynamic loudnorm
    // rides the gain and lifts music-only stretches between lines, which flattens the mix balance. Band-limit
    // before the AAC encoder (bright synth transients make it overshoot) and add a limiter for the peaks.
    // The encoder's overshoot varies with the content, so measure the result: lower the ceiling until the true
    // peak is at or below -1 dBTP, and correct the gain if the limiter pulled the loudness out of range.
    const BAND = 'highpass=f=30,lowpass=f=15000';
    const TARGET_I = -14.1, I_RANGE = [-15, -14];
    const measure = async (args) => {
      let log = '';
      await run([...args, '-f', 'null', '-'], { onStderr: (s) => { log = (log + s).slice(-3000); } });
      const num = (re) => { const v = Number(re.exec(log)?.[1]); return Number.isFinite(v) ? v : null; };
      return { i: num(/I:\s*(-?[\d.]+) LUFS/), tp: num(/True peak:\s*Peak:\s*(-?[\d.]+)/) };
    };
    const mixI = (await measure(['-ss', String(from), '-t', String(dur), '-i', wav, '-af', `${BAND},ebur128`])).i;
    let gain = mixI != null && mixI > -70 ? Math.min(30, Math.max(-30, TARGET_I - mixI)) : 0;
    let limit = 0.71;
    for (let attempt = 0; attempt < 5; attempt++) {
      await run([
        '-f', 'concat', '-safe', '0', '-i', list,
        '-ss', String(from), '-t', String(dur), '-i', wav,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy',
        '-af', `${BAND},volume=${gain.toFixed(2)}dB,aresample=48000,alimiter=limit=${limit.toFixed(3)}:attack=5:release=80:level=0,lowpass=f=16000`,
        '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
        '-shortest', '-movflags', '+faststart',
        job.out,
      ]);
      const m = await measure(['-i', job.out, '-vn', '-af', 'ebur128=peak=true']);
      const tp = m.tp ?? -99, li = m.i;
      const peakOk = tp <= -1, loudOk = li == null || mixI == null || (li >= I_RANGE[0] && li <= I_RANGE[1]);
      if (peakOk && loudOk) break;
      if (!peakOk) limit *= 10 ** (-(tp + 1.3) / 20);
      if (!loudOk) gain += TARGET_I - li;
      job.onProgress?.(0.96, !peakOk ? `Lowering the audio peak ceiling (true peak was ${tp.toFixed(1)} dBTP)` : `Correcting the loudness (was ${li.toFixed(1)} LUFS)`);
    }
    job.onProgress?.(1, `Done in ${Math.round((Date.now() - started) / 1000)}s`);
    return { file: job.out, width, height, fps, duration: dur, seconds: (Date.now() - started) / 1000 };
  } finally {
    for (const w of workers) w.terminate().catch(() => {});
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// Render a single still frame to PNG (used for thumbnails / sharing).
export async function renderStill(project, words, t, out, scale = 0.5) {
  const { createCanvas, setupFonts, env } = await import('./canvas.js');
  const { renderFrame } = await import('../engine/index.js');
  setupFonts();
  const film = compileFilm(project.storyboard, { aspect: project.aspect, words, look: project.look, captions: project.captions });
  const { width, height } = outputSize(project.aspect, '1080p', scale);
  const c = createCanvas(width, height);
  renderFrame(c.getContext('2d'), film, t, { env, endFade: false });
  fs.writeFileSync(out, await c.encode('png'));
  return out;
}
