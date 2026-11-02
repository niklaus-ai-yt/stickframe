// A free, local text-to-speech voice (Kokoro). No account and no API key.
//   cd tools/free-voice && npm install
//   node say.mjs script.txt voice.wav [voice]
// Voices include af_heart, af_bella, am_michael, am_fenrir, bm_george. The first run downloads the model (about 90 MB).
import fs from 'node:fs';
import { KokoroTTS } from 'kokoro-js';

const [, , input, output, voice = 'am_michael'] = process.argv;
if (!input || !output) {
  console.error('usage: node say.mjs script.txt voice.wav [voice]');
  process.exit(1);
}

const RATE = 24000;
const GAP = new Float32Array(Math.round(RATE * 0.12));

const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });

// One sentence at a time: generate() cuts a long text short.
const sentences = fs.readFileSync(input, 'utf8').match(/[^.!?\s][^.!?]*[.!?]*/g) || [];
const parts = [];
for (const sentence of sentences) {
  console.log(sentence.trim());
  const audio = await tts.generate(sentence.trim(), { voice, speed: 1.1 });
  parts.push(audio.audio, GAP);
}

const samples = parts.reduce((n, p) => n + p.length, 0);
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + samples * 2, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(RATE, 24);
wav.writeUInt32LE(RATE * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);
let at = 44;
for (const p of parts) {
  for (const v of p) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v || 0)) * 32767), at);
    at += 2;
  }
}
fs.writeFileSync(output, wav);
console.log(`${output}: ${(samples / RATE).toFixed(1)} s`);
