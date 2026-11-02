#!/usr/bin/env node
// Stickframe from the command line: a thin wrapper over the local HTTP API in server/index.js.
// Every command starts the local server if it is not running. Run `node bin/sf.js help` for the list.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.STICKFRAME_PORT || 4870);
const BASE = `http://127.0.0.1:${PORT}`;

const HELP = `Stickframe CLI

  sf status                               server, ffmpeg and AI mode
  sf list                                 your projects
  sf new "Title" [--aspect 9:16] [--look candy] [--resolution 720p] [--captions]
                                          create a project, prints its id
  sf set <id> key=value ...               change a setting (look, resolution, fps, captions, sfx, title)
  sf mode manual|mcp                      how Stickframe reaches an AI (manual = copy & paste, mcp = the Claude app)

  sf write <id> ideas [--niche "What if"] [--topic t] [--seconds 30] [--reply file]
  sf write <id> breakdown --idea N [--reply file]
  sf write <id> script [--reply file]     writer's room. Without --reply in manual mode, prints the prompt
                                          --seconds carries on to the later steps
  sf script <id> <file>                   load your own script from a text file

  sf say <id>                             free draft voice from your computer's built-in speech, then timing
  sf voice <id> <audio-file>              upload a voiceover (mp3, wav, m4a, ...)
  sf music <id> <audio-file>              use your own music instead of the generated score
  sf transcribe <id> [--model base.en]    time every word with local Whisper

  sf prompt <id> [--part N] [--out file]  print the director prompt to paste into a chatbot
                                          videos over 75 s go in parts of about a minute, one at a time
  sf storyboard <id> <reply-file> [--part N]
                                          apply the chatbot's reply, then says what to run next
  sf storyboard <id> --part N --keep-short
                                          keep a reply that was flagged as short
  sf parts <id> [--restart]               how far a video in parts has got, or start the parts again
  sf prompt <id> --whole [--out file]     one prompt for the whole video, however long
  sf storyboard <id> <file> --whole       apply a complete storyboard
  sf revise <id> <shot> "change" [--reply file]
                                          change one shot in plain English
  sf render <id> [--preview] [--from s] [--to s] [--out file.mp4]
                                          export the MP4, prints where it went
  sf stop                                 stop the local server

Use "-" as a file name to read from stdin. STICKFRAME_HOME and STICKFRAME_PORT work here too.`;

function die(msg) {
  console.error(`sf: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const pos = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (argv[i + 1] != null && !argv[i + 1].startsWith('--')) opts[k] = argv[++i];
      else opts[k] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}

function need(value, usage) {
  if (value == null || value === true) die(`usage: ${usage}`);
  return value;
}

function partNumber(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) die('--part needs a part number, for example --part 2');
  return n;
}

function readInput(file) {
  if (file === '-') return fs.readFileSync(0, 'utf8');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    die(`could not read ${file}: ${e.message}`);
  }
}

function writeOut(file, text) {
  if (file === true) die('--out needs a file name');
  fs.writeFileSync(file, text);
  console.log(file);
}

// ---------------------------------------------------------------- server
async function readToken() {
  const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) });
  const m = /name="sf-token" content="([0-9a-f]+)"/.exec(await res.text());
  if (!m) throw new Error(`port ${PORT} is in use by something other than Stickframe`);
  return m[1];
}

async function connect() {
  try {
    return await readToken();
  } catch (e) {
    if (e.message.startsWith('port ')) die(e.message);
  }
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js'), '--no-open'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      return await readToken();
    } catch { /* still starting */ }
  }
  die('the server did not start. Try "npm start" to see why.');
}

async function api(token, method, route, body, headers = {}) {
  const init = { method, headers: { 'x-sf-token': token, ...headers } };
  if (body != null) {
    if (Buffer.isBuffer(body) || typeof body === 'string') init.body = body;
    else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(`${BASE}/api${route}`, init);
  const data = await res.json();
  if (!res.ok) die(data.error || `HTTP ${res.status}`);
  return data;
}

// Follows a job to the end. A job that needs copy & paste comes back with status "manual" and its prompt.
async function waitJob(token, job) {
  let last = '';
  while (job.status === 'running') {
    if (job.message && job.message !== last) { last = job.message; console.error(`  ${job.message}`); }
    await new Promise((r) => setTimeout(r, 500));
    job = await api(token, 'GET', `/jobs/${job.id}`);
  }
  if (job.status === 'error') die(job.error);
  if (job.status === 'cancelled') die('cancelled');
  return job;
}

// Prints a manual prompt, or returns the finished job.
function promptOrDone(job, opts, nextStep) {
  if (job.status !== 'manual') return job;
  if (opts.out) writeOut(opts.out, job.result.prompt);
  else console.log(job.result.prompt);
  console.error(`\nPaste that into any AI chatbot (${job.result.prompt.length} characters), save the reply to a file, then run:\n  ${nextStep}`);
  process.exit(0);
}

async function upload(token, id, kind, file) {
  if (!fs.existsSync(file)) die(`no such file: ${file}`);
  const name = encodeURIComponent(path.basename(file));
  return api(token, 'PUT', `/projects/${id}/upload?kind=${kind}&name=${name}`, fs.readFileSync(file));
}

function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return /^\d+$/.test(v) ? Number(v) : v;
}

// ---------------------------------------------------------------- commands
const commands = {
  async status(t) {
    const s = await api(t, 'GET', '/status');
    console.log(`Stickframe ${s.version}\nData folder: ${s.home}\nffmpeg: ${s.ffmpeg ? s.ffmpeg.version : 'NOT FOUND'}\nAI mode: ${s.settings.claudeMode}\nSpeech model: ${s.settings.whisperModel}`);
  },
  async list(t) {
    for (const p of await api(t, 'GET', '/projects')) console.log(`${p.id}\t${p.title}\t${p.shots} shots${p.hasRender ? '\trendered' : ''}`);
  },
  async new(t, pos, opts) {
    const title = need(pos[0], 'sf new "Title"');
    const p = await api(t, 'POST', '/projects', { title, aspect: opts.aspect });
    const patch = {};
    for (const k of ['look', 'resolution']) if (opts[k]) patch[k] = opts[k];
    if (opts.captions) patch.captions = true;
    if (Object.keys(patch).length) await api(t, 'PATCH', `/projects/${p.id}`, patch);
    console.log(p.id);
  },
  async set(t, pos) {
    const id = need(pos[0], 'sf set <id> key=value ...');
    const patch = {};
    for (const kv of pos.slice(1)) {
      const at = kv.indexOf('=');
      if (at < 1) die(`expected key=value, got "${kv}"`);
      patch[kv.slice(0, at)] = coerce(kv.slice(at + 1));
    }
    const p = await api(t, 'PATCH', `/projects/${id}`, patch);
    for (const k of Object.keys(patch)) console.log(`${k} = ${JSON.stringify(p[k])}`);
  },
  async mode(t, pos) {
    const claudeMode = need(pos[0], 'sf mode manual|mcp');
    if (!['manual', 'mcp'].includes(claudeMode)) die('mode must be manual or mcp');
    await api(t, 'POST', '/settings', { claudeMode });
    console.log(`AI mode: ${claudeMode}`);
  },
  async write(t, pos, opts) {
    const id = need(pos[0], 'sf write <id> ideas|breakdown|script');
    const step = need(pos[1], 'sf write <id> ideas|breakdown|script');
    const body = { manualReply: opts.reply ? readInput(opts.reply) : undefined };
    const seconds = Number(opts.seconds) || 0;
    const options = { niche: opts.niche, topic: opts.topic, format: seconds ? (seconds <= 60 ? 'short' : 'long') : undefined, minutes: seconds > 60 ? Math.round(seconds / 6) / 10 : undefined };
    body.options = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
    if (step === 'breakdown') {
      const p = await api(t, 'GET', `/projects/${id}`);
      const n = Number(need(opts.idea, 'sf write <id> breakdown --idea N'));
      body.idea = p.writer?.ideas?.[n - 1] || die(`no idea number ${n}. Run "sf write ${id} ideas" first.`);
    }
    const done = promptOrDone(await waitJob(t, await api(t, 'POST', `/projects/${id}/writer/${step}`, body)), opts, `sf write ${id} ${step}${opts.idea ? ` --idea ${opts.idea}` : ''} --reply reply.txt`);
    const w = done.result.writer;
    if (step === 'ideas') w.ideas.forEach((i, k) => console.log(`${k + 1}. ${i.title}`));
    if (step === 'breakdown') console.log(w.breakdown.title || 'Breakdown saved');
    if (step === 'script') console.log((await api(t, 'GET', `/projects/${id}`)).script);
  },
  async script(t, pos) {
    const id = need(pos[0], 'sf script <id> <file>');
    await api(t, 'PATCH', `/projects/${id}`, { script: readInput(need(pos[1], 'sf script <id> <file>')) });
    console.log('Script saved');
  },
  async say(t, pos) {
    const id = need(pos[0], 'sf say <id>');
    const done = await waitJob(t, await api(t, 'POST', `/projects/${id}/draft-voice`, {}));
    console.log(`${done.result.duration.toFixed(1)} s, ${done.result.words} words timed`);
  },
  async voice(t, pos) {
    const id = need(pos[0], 'sf voice <id> <audio-file>');
    const p = await upload(t, id, 'voice', need(pos[1], 'sf voice <id> <audio-file>'));
    console.log(`${p.voice.duration.toFixed(1)} s`);
  },
  async music(t, pos) {
    const id = need(pos[0], 'sf music <id> <audio-file>');
    const p = await upload(t, id, 'music', need(pos[1], 'sf music <id> <audio-file>'));
    console.log(`${p.music.duration.toFixed(1)} s`);
  },
  async transcribe(t, pos, opts) {
    const id = need(pos[0], 'sf transcribe <id>');
    const done = await waitJob(t, await api(t, 'POST', `/projects/${id}/transcribe`, { model: opts.model, language: opts.language }));
    console.log(`${done.result.words} words timed`);
    const seconds = (await api(t, 'GET', `/projects/${id}`)).voice?.duration || 0;
    if (done.result.words < seconds / 4) console.log(`  warning: that is very few words for ${seconds.toFixed(0)} s of audio. Listen to the file, or try --model small.en`);
  },
  async prompt(t, pos, opts) {
    const id = need(pos[0], 'sf prompt <id> [--part N] [--whole] [--out file]');
    const body = { whole: !!opts.whole };
    if (opts.part != null) body.part = partNumber(opts.part);
    const job = await waitJob(t, await api(t, 'POST', `/projects/${id}/storyboard`, body));
    if (job.status !== 'manual') die('this project is already directed.');
    const r = job.result;
    if (!r.part) return promptOrDone(job, opts, `sf storyboard ${id} reply.txt${opts.whole ? ' --whole' : ''}`);
    if (opts.out) writeOut(opts.out, r.prompt);
    else console.log(r.prompt);
    console.error(`\nPart ${r.part} of ${r.total}: ${r.start.toFixed(1)} to ${r.end.toFixed(1)} s, ${r.prompt.length} characters.`);
    if (r.issue) console.error(`Its last reply was flagged: ${r.issue}`);
    console.error(`Paste the prompt into any AI chatbot, save the reply to a file, then run:\n  sf storyboard ${id} reply-${r.part}.txt --part ${r.part}`);
  },
  async storyboard(t, pos, opts) {
    const id = need(pos[0], 'sf storyboard <id> <reply-file> [--part N] [--whole] [--keep-short]');
    const body = pos[1] ? { manualReply: readInput(pos[1]) } : {};
    if (opts.part != null) body.part = partNumber(opts.part);
    if (opts.whole) body.whole = true;
    if (opts['keep-short']) {
      if (!body.part) die('usage: sf storyboard <id> --part N --keep-short');
      body.acceptShort = true;
    }
    const job = await waitJob(t, await api(t, 'POST', `/projects/${id}/storyboard`, body));
    if (job.status === 'manual') {
      const r = job.result;
      if (!body.manualReply && !body.acceptShort) die(`the AI mode is copy & paste. Run "sf prompt ${id}", then "sf storyboard ${id} reply.txt".`);
      if (!r.flagged) {
        console.log(`Saved. ${r.parts.filter((x) => x.status === 'ok').length} of ${r.total} parts done. Next:\n  sf prompt ${id} --part ${r.part} --out prompt-${r.part}.txt`);
        return;
      }
      console.log(`Part ${r.part} of ${r.total} needs another try: ${r.issue}\nTo retry just this part:\n  sf prompt ${id} --part ${r.part} --out prompt-${r.part}.txt\n  sf storyboard ${id} reply-${r.part}.txt --part ${r.part}`);
      if (r.canKeep) console.log(`To keep it anyway, stretching its shots to fill the part:\n  sf storyboard ${id} --part ${r.part} --keep-short`);
      process.exit(2);
    }
    console.log(`${job.result.shots} shots${job.result.parts ? `, merged from ${job.result.parts} parts` : ''}`);
    for (const w of job.result.warnings || []) console.log(`  warning: ${w}`);
  },
  async parts(t, pos, opts) {
    const id = need(pos[0], 'sf parts <id> [--restart]');
    if (opts.restart) await waitJob(t, await api(t, 'POST', `/projects/${id}/storyboard`, { restart: true }));
    const plan = (await api(t, 'GET', `/projects/${id}`)).parts;
    if (!plan) return console.log(`No parts yet. Videos over 75 s are split when you run "sf prompt ${id}".`);
    for (const x of plan.parts) console.log(`Part ${x.n}\t${x.start.toFixed(1)}-${x.end.toFixed(1)} s\t${x.status}${x.shots?.length ? `\t${x.shots.length} shots` : ''}${x.issue ? `\t${x.issue}` : ''}`);
  },
  async revise(t, pos, opts) {
    const id = need(pos[0], 'sf revise <id> <shot> "change"');
    const shotId = need(pos[1], 'sf revise <id> <shot> "change"');
    const instruction = pos[2];
    const job = await waitJob(t, await api(t, 'POST', `/projects/${id}/revise`, { shotId, instruction, manualReply: opts.reply ? readInput(opts.reply) : undefined }));
    promptOrDone(job, opts, `sf revise ${id} ${shotId} "${instruction}" --reply reply.txt`);
    console.log(`${shotId} updated`);
  },
  async render(t, pos, opts) {
    const id = need(pos[0], 'sf render <id>');
    const body = { preview: !!opts.preview };
    if (opts.from != null) body.from = Number(opts.from);
    if (opts.to != null) body.to = Number(opts.to);
    const done = await waitJob(t, await api(t, 'POST', `/projects/${id}/render`, body));
    const status = await api(t, 'GET', '/status');
    const made = path.join(status.home, 'projects', id, done.result.file);
    if (opts.out) {
      if (opts.out === true) die('--out needs a file name');
      fs.copyFileSync(made, opts.out);
      console.log(opts.out);
    } else console.log(made);
  },
  async stop(t) {
    await api(t, 'POST', '/shutdown');
    console.log('Stopped');
  },
};

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(HELP);
} else if (!commands[cmd]) {
  die(`unknown command "${cmd}". Run "sf help".`);
} else {
  const { pos, opts } = parseArgs(rest);
  const token = await connect();
  await commands[cmd](token, pos, opts);
}
