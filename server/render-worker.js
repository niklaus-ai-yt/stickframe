// Worker thread: renders a frame range and pipes raw RGBA frames into ffmpeg.
import { parentPort, workerData } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { compileFilm, renderFrame } from '../engine/index.js';
import { setupFonts, createCanvas, env } from './canvas.js';

const d = workerData;

async function main() {
  setupFonts();
  const film = compileFilm(d.story, d.meta);
  const canvas = createCanvas(d.width, d.height);
  const g = canvas.getContext('2d');
  const ff = spawn(d.ffmpeg, [
    '-hide_banner', '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${d.width}x${d.height}`, '-r', String(d.fps), '-i', '-',
    '-c:v', 'libx264', '-preset', d.preset, '-crf', String(d.crf), '-pix_fmt', 'yuv420p', '-r', String(d.fps),
    d.file,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (x) => { err += x; });
  const closed = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Encoder failed: ${err.slice(-400)}`))));
  });
  let done = 0;
  for (let f = d.frameStart; f < d.frameEnd; f++) {
    renderFrame(g, film, f / d.fps, { env, look: d.look });
    const px = Buffer.from(canvas.data());
    if (!ff.stdin.write(px)) await new Promise((r) => ff.stdin.once('drain', r));
    done++;
    if (done % 10 === 0) parentPort.postMessage({ type: 'progress', done });
  }
  ff.stdin.end();
  await closed;
  parentPort.postMessage({ type: 'progress', done });
  parentPort.postMessage({ type: 'done' });
}

main().catch((e) => parentPort.postMessage({ type: 'error', message: e.message }));
