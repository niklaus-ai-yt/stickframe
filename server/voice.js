// Speech: local Whisper transcription with word timings, subtitle import,
// timing estimates for silent drafts, and an optional system "draft voice".
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { decodePcm, ffmpegPath, run } from './media.js';
import { MODELS } from './store.js';

const WHISPER_MODELS = {
  'tiny.en': 'onnx-community/whisper-tiny.en_timestamped',
  'base.en': 'onnx-community/whisper-base.en_timestamped',
  'small.en': 'onnx-community/whisper-small.en_timestamped',
  base: 'onnx-community/whisper-base_timestamped',
  small: 'onnx-community/whisper-small_timestamped',
};
export const WHISPER_MODEL_IDS = Object.keys(WHISPER_MODELS);

const pipelines = new Map();

async function getPipeline(model, onProgress) {
  const id = WHISPER_MODELS[model] || WHISPER_MODELS['base.en'];
  if (pipelines.has(id)) return pipelines.get(id);
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = MODELS;
  env.allowLocalModels = true;
  const files = new Map();
  const p = await pipeline('automatic-speech-recognition', id, {
    dtype: 'fp32',
    progress_callback: (e) => {
      if (e.status === 'progress' && e.file) {
        files.set(e.file, { loaded: e.loaded || 0, total: e.total || 0 });
        let l = 0, t = 0;
        for (const f of files.values()) { l += f.loaded; t += f.total; }
        if (t) onProgress?.(l / t, `Downloading speech model (${Math.round(t / 1e6)} MB, first time only)`);
      }
    },
  });
  pipelines.set(id, p);
  return p;
}

export async function transcribe(file, { model = 'base.en', language, onProgress } = {}) {
  onProgress?.(0, 'Loading speech model');
  const asr = await getPipeline(model, onProgress);
  onProgress?.(0.05, 'Reading audio');
  const pcm = await decodePcm(file, 16000);
  const total = pcm.length / 16000;
  // Work in 30-second windows with a 5-second overlap so we can report progress.
  const win = 30, hop = 25;
  const words = [];
  for (let s = 0; s < total; s += hop) {
    const a = Math.floor(s * 16000), b = Math.min(pcm.length, Math.floor((s + win) * 16000));
    const slice = pcm.subarray(a, b);
    const opts = { return_timestamps: 'word' };
    if (language && !model.endsWith('.en')) { opts.language = language; opts.task = 'transcribe'; }
    const out = await asr(slice, opts);
    const keepFrom = s === 0 ? 0 : s + 2.5; // overlap: earlier window owns the first half
    const keepTo = s + hop + 2.5;
    for (const c of out.chunks || []) {
      const st = (c.timestamp?.[0] ?? 0) + s, en = (c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0) + s;
      if (st < keepFrom || (st >= keepTo && s + win < total)) continue;
      const text = String(c.text || '').trim();
      if (!text) continue;
      words.push({ text, start: +st.toFixed(2), end: +Math.max(st + 0.05, en).toFixed(2) });
    }
    onProgress?.(0.1 + 0.9 * Math.min(1, (s + win) / total), `Transcribing ${Math.min(Math.round(s + win), Math.round(total))}s / ${Math.round(total)}s`);
    if (b >= pcm.length) break;
  }
  return cleanWords(words);
}

function cleanWords(words) {
  words.sort((a, b) => a.start - b.start);
  const out = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.start - w.start) < 0.05 && prev.text === w.text) continue;
    if (prev && prev.end > w.start) prev.end = Math.max(prev.start + 0.05, w.start);
    out.push(w);
  }
  return out;
}

// ---------- subtitles ----------
function parseTs(s) {
  const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(s);
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +(`0.${m[4]}`);
}

// SRT/VTT cues become words spread evenly across each cue.
export function wordsFromSubtitles(text) {
  const words = [];
  const blocks = String(text).replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n').filter(Boolean);
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split('-->');
    const st = parseTs(a), en = parseTs(z);
    if (st == null || en == null) continue;
    const toks = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean);
    toks.forEach((t, i) => {
      const s0 = st + ((en - st) * i) / toks.length;
      words.push({ text: t, start: +s0.toFixed(2), end: +(s0 + (en - st) / toks.length).toFixed(2) });
    });
  }
  return words;
}

// Estimated timing for a script with no audio (silent drafts / previews).
export function estimateWords(script, wpm = 165) {
  const toks = String(script || '').split(/\s+/).filter(Boolean);
  const words = [];
  let t = 0.3;
  const per = 60 / wpm;
  for (const tok of toks) {
    const len = per * (0.55 + Math.min(1.4, tok.replace(/[^a-z0-9]/gi, '').length / 7));
    words.push({ text: tok, start: +t.toFixed(2), end: +(t + len * 0.9).toFixed(2) });
    t += len;
    if (/[.!?]$/.test(tok)) t += 0.45;
    else if (/[,;:]$/.test(tok)) t += 0.2;
  }
  return words;
}

// ---------- draft voice using the operating system's built-in speech ----------
export async function draftVoice(script, outFile) {
  const tmpTxt = path.join(os.tmpdir(), `sf-tts-${Date.now()}.txt`);
  fs.writeFileSync(tmpTxt, String(script), 'utf8');
  const tmpAudio = outFile.replace(/\.[a-z0-9]+$/i, '') + (process.platform === 'darwin' ? '.aiff' : '.wav');
  try {
    if (process.platform === 'win32') {
      const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 0; $s.SetOutputToWaveFile('${tmpAudio.replace(/'/g, "''")}'); $s.Speak([IO.File]::ReadAllText('${tmpTxt.replace(/'/g, "''")}')); $s.Dispose()`;
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    } else if (process.platform === 'darwin') {
      await exec('say', ['-f', tmpTxt, '-o', tmpAudio]);
    } else {
      await exec('espeak-ng', ['-f', tmpTxt, '-w', tmpAudio]).catch(() => exec('espeak', ['-f', tmpTxt, '-w', tmpAudio]));
    }
    if (tmpAudio !== outFile) {
      await run(['-i', tmpAudio, '-ar', '44100', '-ac', '1', outFile]);
      if (tmpAudio !== outFile) fs.rmSync(tmpAudio, { force: true });
    }
  } finally {
    fs.rmSync(tmpTxt, { force: true });
  }
  return outFile;
}

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error(`${cmd} is not available: ${e.message}`)));
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} failed: ${err.slice(-300)}`))));
  });
}

export { ffmpegPath };
