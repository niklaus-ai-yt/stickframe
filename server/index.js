// Stickframe local server. Serves the studio UI and a small JSON API on 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as store from './store.js';
import { findFfmpeg, probeDuration } from './media.js';
import { transcribe, wordsFromSubtitles, estimateWords, draftVoice, WHISPER_MODEL_IDS } from './voice.js';
import { askJson, extractJson, ManualNeeded, manualPrompt, checkConnection, mcpHello, mcpStatus } from './claude.js';
import { extensionBundle } from './mcpb.js';
import * as prompts from './prompts.js';
import * as multipart from './parts.js';
import { renderVideo, renderStill, outputSize } from './render.js';
import { mixAudio, loadSfxLibrary } from './audio.js';
import { validateStoryboard, compileFilm, catalog, LOOKS } from '../engine/index.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PORT = Number(process.env.STICKFRAME_PORT || 4870);
const TOKEN = crypto.randomBytes(16).toString('hex');

// ---------------------------------------------------------------- jobs
const jobs = new Map();
function startJob(kind, projectId, fn) {
  const id = crypto.randomBytes(6).toString('hex');
  const ac = new AbortController();
  const job = { id, kind, projectId, status: 'running', progress: 0, message: 'Starting', result: null, error: null, started: Date.now(), ac };
  jobs.set(id, job);
  const update = (p, m) => { if (p != null) job.progress = Math.max(0, Math.min(1, p)); if (m) job.message = m; };
  Promise.resolve()
    .then(() => fn(update, ac.signal))
    .then((r) => { job.status = 'done'; job.progress = 1; job.result = r ?? null; })
    .catch((e) => {
      if (e instanceof ManualNeeded) { job.status = 'manual'; job.result = { prompt: e.prompt, ...e.info }; return; }
      job.status = ac.signal.aborted ? 'cancelled' : 'error';
      job.error = e.message || String(e);
      console.error(`[${kind}]`, e.message);
    });
  // forget finished jobs after an hour
  setTimeout(() => jobs.delete(id), 3600e3).unref();
  return job;
}
const jobView = (j) => ({ id: j.id, kind: j.kind, projectId: j.projectId, status: j.status, progress: j.progress, message: j.message, result: j.result, error: j.error });
const busy = (projectId, kind) => [...jobs.values()].find((j) => j.projectId === projectId && j.status === 'running' && (!kind || j.kind === kind));

// ---------------------------------------------------------------- helpers
function voicePath(p) { return p.voice?.file ? store.projectFile(p.id, p.voice.file) : null; }
function musicPath(p) { return p.music?.file ? store.projectFile(p.id, p.music.file) : null; }
function projectDuration(p) {
  if (p.voice?.duration) return p.voice.duration + 1.0;
  const w = p.words || [];
  return w.length ? w[w.length - 1].end + 1.5 : 10;
}
// The project's sound library (its own "sfxLibrary" or STICKFRAME_SFX_LIBRARY) and the IDs the validator keeps.
const sfxLib = (p) => loadSfxLibrary(p.sfxLibrary);
const sfxIds = (p) => sfxLib(p)?.ids || [];
function directorOpts(p) {
  return { aspect: p.aspect, duration: projectDuration(p), look: p.look, captions: p.captions, title: p.title, brief: p.brief, breakdown: p.writer?.breakdown, words: p.words || [] };
}

async function buildPreviewMix(p, update) {
  const out = store.projectFile(p.id, 'preview-mix.wav');
  const film = compileFilm(p.storyboard, { aspect: p.aspect, words: p.words, look: p.look, duration: projectDuration(p) });
  await mixAudio({ out, duration: film.duration, voiceFile: voicePath(p), musicSections: p.storyboard?.music, musicFile: musicPath(p), musicMode: p.music?.mode || 'auto', musicVolume: p.music?.volume ?? 0.5, sfx: film.sfx, sfxOn: p.sfx !== false, sfxLibrary: p.sfxLibrary, onProgress: update });
  store.updateProject(p.id, { previewMix: { file: 'preview-mix.wav', at: Date.now() } });
  return out;
}

// Long video in copy & paste mode: applies one reply, then returns the merged storyboard if every part
// is done, or asks for the next part's prompt. Progress is saved on the project after every reply.
function directInParts(p, o, b) {
  const stale = p.parts?.key !== multipart.partsKey(o.words, o.duration);
  const plan = stale || b.restart ? multipart.newPlan(o.words, o.duration) : p.parts;
  let target = b.part != null ? Number(b.part) : null;
  if (target != null && !plan.parts.some((x) => x.n === target)) throw new Error(`There is no part ${b.part}. This video has ${plan.parts.length} parts.`);
  const allowed = multipart.firstUnfinished(plan)?.n ?? plan.parts.length;
  if (target != null && target > allowed) throw new Error(`Do part ${allowed} first: part ${target} carries on from it.`);

  let flagged = null; // what was wrong with the reply just pasted
  let part = target != null ? plan.parts.find((x) => x.n === target) : null;
  if (b.manualReply) {
    part = part || plan.parts.find((x) => x.n === allowed);
    let reply = null;
    try { reply = extractJson(b.manualReply); } catch { /* flagged below */ }
    const checked = reply ? multipart.checkPartReply(reply, part) : { status: 'broken', issue: 'The reply did not contain valid JSON. It may have been cut off.', shots: [], covered: 0 };
    if (checked.status !== 'ok') flagged = { status: checked.status, issue: part.status === 'ok' ? `${checked.issue} The reply you had before is still in use.` : checked.issue };
    if (checked.status === 'ok' || part.status !== 'ok') Object.assign(part, checked); // a failed retry never replaces a good reply
  } else if (b.acceptShort) {
    if (part?.status !== 'short') throw new Error(`Part ${target ?? '?'} has no short reply to keep.`);
    part.status = 'ok';
    part.issue = null;
  } else if (target == null && multipart.allDone(plan)) {
    plan.parts = multipart.newPlan(o.words, o.duration).parts; // finished earlier, so this is a fresh start
  }
  store.updateProject(p.id, { parts: plan });

  // a flagged reply stays on its part; an applied one moves to the first part still unfinished, or the merge
  const applied = b.manualReply || b.acceptShort;
  if (applied && !flagged && multipart.allDone(plan)) return multipart.mergeParts(plan, o.duration);
  if (!flagged && (applied || !part)) part = multipart.firstUnfinished(plan);
  const system = prompts.directorSystem(sfxLib(p), { compact: true });
  const user = prompts.partPrompt({ ...o, part, total: plan.parts.length, carry: multipart.carryFrom(plan, part.n) });
  throw new ManualNeeded(manualPrompt(system, user), { part: part.n, total: plan.parts.length, start: part.start, end: part.end, status: flagged?.status ?? part.status, issue: flagged?.issue ?? part.issue ?? null, flagged: !!flagged, canKeep: part.status === 'short', parts: multipart.partsSummary(plan) });
}

async function generateStoryboard(p, b, update) {
  const o = directorOpts(p);
  if (!o.words.length) throw new Error('No transcript yet. Add a voiceover and transcribe it first (or use "No voiceover yet" to time the script).');
  const { manualReply } = b;
  const system = prompts.directorSystem(sfxLib(p));
  const mode = store.getSettings().claudeMode;
  let raw;
  // A reply with no part number that already covers the whole video is a complete storyboard.
  const wholeReply = () => {
    if (!manualReply || b.part != null) return false;
    try {
      const shots = extractJson(manualReply).shots;
      return Array.isArray(shots) && Math.max(...shots.map((s) => Number(s?.end) || 0)) >= o.duration * 0.9;
    } catch { return false; }
  };
  const inParts = mode === 'manual' && multipart.needsParts(o.duration) && !b.whole && !wholeReply();
  if (inParts) {
    raw = directInParts(p, o, b);
  } else {
    // Copy & paste under 75 s, or the Claude app (which reads the whole prompt at once over MCP).
    update(0.1, 'Directing the storyboard');
    raw = await askJson(system, prompts.fullStoryboardPrompt(o), { manualReply });
  }
  update(0.92, 'Checking the storyboard');
  const { story, warnings } = validateStoryboard(raw, { duration: o.duration, title: p.title, sfxIds: sfxIds(p) });
  const saved = store.updateProject(p.id, { storyboard: story, warnings, title: p.title === 'Untitled video' && story.title ? story.title : p.title });
  update(0.95, 'Preparing preview audio');
  try { await buildPreviewMix(saved, () => {}); } catch (e) { console.warn('preview mix failed:', e.message); }
  return { shots: story.shots.length, warnings, ...(inParts ? { parts: saved.parts.parts.length } : {}) };
}

// ---------------------------------------------------------------- http plumbing
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac', '.webm': 'audio/webm', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

function send(res, code, body, type = 'application/json') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}
const ok = (res, body) => send(res, 200, body);
const fail = (res, code, msg) => send(res, code, { error: msg });

function sendFile(req, res, file, { download } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return fail(res, 404, 'Not found'); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file).replace(/"/g, '')}"`;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  }
}

function readBody(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const b = await readBody(req);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw new Error('Invalid JSON body'); }
}

function streamToFile(req, file, limit = 1.5e9) {
  return new Promise((resolve, reject) => {
    const tmp = file + '.part';
    const out = fs.createWriteStream(tmp);
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { req.destroy(); out.destroy(); fs.rmSync(tmp, { force: true }); reject(new Error('File too large')); } });
    req.pipe(out);
    out.on('finish', () => { fs.renameSync(tmp, file); resolve(n); });
    out.on('error', reject);
    req.on('error', reject);
  });
}

function staticFile(req, res, base, rel) {
  const full = path.resolve(base, '.' + path.sep + rel);
  if (!full.startsWith(base + path.sep)) return fail(res, 403, 'Forbidden');
  if (path.basename(full) === 'index.html') return serveIndex(res);
  sendFile(req, res, full);
}

function serveIndex(res) {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace('__SF_TOKEN__', TOKEN).replace(/__SF_VERSION__/g, PKG.version);
  send(res, 200, html, 'text/html; charset=utf-8');
}

function openInOs(target) {
  const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [target], { detached: true, stdio: 'ignore' }).unref();
}

const PATCHABLE = ['title', 'aspect', 'resolution', 'fps', 'look', 'captions', 'music', 'sfx', 'sfxLibrary', 'script', 'brief', 'writer'];

// ---------------------------------------------------------------- routes
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const M = req.method;

  if (parts[0] === 'status' && M === 'GET') {
    const ff = findFfmpeg();
    return ok(res, { version: PKG.version, ffmpeg: ff, home: store.HOME, settings: store.publicSettings(), mcp: mcpStatus(), whisperModels: WHISPER_MODEL_IDS, looks: Object.values(LOOKS).map((l) => ({ id: l.id, name: l.name, blurb: l.blurb, swatch: l.swatch })), platform: process.platform });
  }
  if (parts[0] === 'catalog' && M === 'GET') return ok(res, catalog());
  if (parts[0] === 'shutdown' && M === 'POST') { ok(res, { stopping: true }); setTimeout(() => process.exit(0), 100); return; }
  if (parts[0] === 'settings' && M === 'POST') {
    const b = await readJson(req);
    const patch = {};
    for (const k of ['claudeMode', 'whisperModel', 'workers']) if (k in b) patch[k] = b[k];
    store.saveSettings(patch);
    return ok(res, store.publicSettings());
  }
  if (parts[0] === 'claude' && parts[1] === 'test' && M === 'POST') return ok(res, await checkConnection());
  if (parts[0] === 'mcp' && parts[1] === 'hello' && M === 'POST') { mcpHello(); return ok(res, mcpStatus()); }
  if (parts[0] === 'mcp' && parts[1] === 'extension' && M === 'GET') {
    const zip = extensionBundle({ root: ROOT, port: PORT, home: store.HOME, version: PKG.version });
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="stickframe.mcpb"', 'Content-Length': zip.length });
    return res.end(zip);
  }

  if (parts[0] === 'jobs' && parts[1]) {
    const j = jobs.get(parts[1]);
    if (!j) return fail(res, 404, 'Job not found');
    if (parts[2] === 'cancel' && M === 'POST') { j.ac.abort(); j.status = 'cancelled'; return ok(res, jobView(j)); }
    return ok(res, jobView(j));
  }

  if (parts[0] !== 'projects') return fail(res, 404, 'Unknown endpoint');

  if (parts.length === 1) {
    if (M === 'GET') return ok(res, store.listProjects());
    if (M === 'POST') {
      const b = await readJson(req);
      const p = store.createProject({ title: String(b.title || 'Untitled video').slice(0, 120), aspect: b.aspect === '9:16' ? '9:16' : '16:9', captions: b.aspect === '9:16' });
      return ok(res, p);
    }
  }
  if (parts[1] === 'demo' && M === 'POST') {
    const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'pause-button.json'), 'utf8'));
    const words = estimateWords(ex.script);
    const p = store.createProject({ title: ex.storyboard.title, script: ex.script, words, voice: null, timing: 'estimated' });
    const dur = words[words.length - 1].end + 1.5;
    // stretch the example's timings onto the estimated narration
    const k = dur / ex.duration;
    const sb = JSON.parse(JSON.stringify(ex.storyboard));
    for (const s of sb.shots) { s.start *= k; s.end *= k; }
    for (const m of sb.music || []) { m.start *= k; m.end *= k; }
    const { story } = validateStoryboard(sb, { duration: dur, sfxIds: sfxIds(p) });
    return ok(res, store.updateProject(p.id, { storyboard: story }));
  }

  const id = parts[1];
  let p;
  try { p = store.loadProject(id); } catch { return fail(res, 404, 'Project not found'); }
  const sub = parts[2];

  if (!sub) {
    if (M === 'GET') return ok(res, { ...p, duration: projectDuration(p), outputSize: outputSize(p.aspect, p.resolution), busy: [...jobs.values()].filter((j) => j.projectId === id && j.status === 'running').map(jobView) });
    if (M === 'PATCH') {
      const b = await readJson(req);
      const patch = {};
      for (const k of PATCHABLE) if (k in b) patch[k] = b[k];
      if ('sfxLibrary' in patch) patch.sfxLibrary = typeof patch.sfxLibrary === 'string' && patch.sfxLibrary.trim() ? patch.sfxLibrary.trim() : null;
      // exact word timings from the voice generator (e.g. TTS alignment), replacing the speech-recognition transcript
      if (Array.isArray(b.words)) {
        const words = b.words
          .filter((w) => w && typeof w.text === 'string' && w.text.trim() && isFinite(w.start) && isFinite(w.end))
          .map((w) => ({ text: w.text.trim(), start: +w.start, end: Math.max(+w.start, +w.end) }))
          .sort((a, c) => a.start - c.start);
        if (!words.length) return fail(res, 400, 'No usable words (each needs text, start, end)');
        patch.words = words;
        patch.timing = 'aligned';
      }
      if ('storyboard' in b) {
        const { story, warnings } = validateStoryboard(b.storyboard, { duration: projectDuration(p), sfxIds: sfxIds({ ...p, ...patch }) });
        patch.storyboard = story;
        patch.warnings = warnings;
      }
      if (patch.aspect && !['16:9', '9:16'].includes(patch.aspect)) delete patch.aspect;
      if (patch.resolution && !['720p', '1080p', '1440p', '2160p'].includes(patch.resolution)) delete patch.resolution;
      if (patch.fps && ![24, 25, 30, 60].includes(+patch.fps)) delete patch.fps;
      return ok(res, store.updateProject(id, patch));
    }
    if (M === 'DELETE') { store.deleteProject(id); return ok(res, { deleted: id }); }
  }

  if (sub === 'upload' && M === 'PUT') {
    const kind = url.searchParams.get('kind');
    const name = String(url.searchParams.get('name') || 'file').replace(/[^\w.\- ]/g, '_');
    const ext = (path.extname(name) || '.bin').toLowerCase();
    if (kind === 'voice' || kind === 'music') {
      if (!['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm', '.mp4', '.opus'].includes(ext)) return fail(res, 400, 'Unsupported audio format');
      const fname = `${kind}${ext}`;
      for (const f of fs.readdirSync(store.projectDir(id))) if (f.startsWith(kind + '.')) fs.rmSync(store.projectFile(id, f), { force: true });
      await streamToFile(req, store.projectFile(id, fname));
      let duration;
      try { duration = probeDuration(store.projectFile(id, fname)); } catch (e) { fs.rmSync(store.projectFile(id, fname), { force: true }); return fail(res, 400, e.message); }
      if (kind === 'voice') return ok(res, store.updateProject(id, { voice: { file: fname, name, duration }, timing: null }));
      return ok(res, store.updateProject(id, { music: { ...(p.music || {}), mode: 'file', file: fname, name, duration } }));
    }
    if (kind === 'script' || kind === 'subs') {
      const text = (await readBody(req, 5e6)).toString('utf8');
      if (kind === 'subs' || /-->/.test(text)) {
        const words = wordsFromSubtitles(text);
        if (!words.length) return fail(res, 400, 'No subtitle cues found in that file');
        return ok(res, store.updateProject(id, { words, timing: 'subtitles', script: p.script || words.map((w) => w.text).join(' ') }));
      }
      return ok(res, store.updateProject(id, { script: text }));
    }
    return fail(res, 400, 'Unknown upload kind');
  }

  if (sub === 'file' && parts[3] && M === 'GET') {
    const file = store.projectFile(id, decodeURIComponent(parts.slice(3).join('/')));
    return sendFile(req, res, file, { download: url.searchParams.get('download') === '1' });
  }

  if (sub === 'open-folder' && M === 'POST') { openInOs(store.projectDir(id)); return ok(res, { opened: true }); }

  if (sub === 'transcribe' && M === 'POST') {
    if (!p.voice) return fail(res, 400, 'Upload a voiceover first');
    if (busy(id, 'transcribe')) return fail(res, 409, 'Already transcribing');
    const b = await readJson(req);
    const job = startJob('transcribe', id, async (update) => {
      const s = store.getSettings();
      const words = await transcribe(voicePath(p), { model: b.model || s.whisperModel, language: b.language, onProgress: update });
      if (!words.length) throw new Error('No speech was found in that audio.');
      store.updateProject(id, { words, timing: 'whisper', script: p.script || words.map((w) => w.text).join(' ') });
      return { words: words.length };
    });
    return ok(res, jobView(job));
  }

  if (sub === 'estimate' && M === 'POST') {
    const b = await readJson(req);
    const script = String(b.script ?? p.script ?? '').trim();
    if (!script) return fail(res, 400, 'Write or paste a script first');
    const words = estimateWords(script, Number(b.wpm) || 165);
    return ok(res, store.updateProject(id, { script, words, timing: 'estimated' }));
  }

  if (sub === 'draft-voice' && M === 'POST') {
    const script = String(p.script || '').trim();
    if (!script) return fail(res, 400, 'Write or paste a script first');
    const job = startJob('draft-voice', id, async (update) => {
      update(0.05, 'Speaking the script with your system voice');
      const out = store.projectFile(id, 'voice.wav');
      for (const f of fs.readdirSync(store.projectDir(id))) if (f.startsWith('voice.')) fs.rmSync(store.projectFile(id, f), { force: true });
      await draftVoice(script, out);
      const duration = probeDuration(out);
      store.updateProject(id, { voice: { file: 'voice.wav', name: 'Draft voice (system)', duration, draft: true } });
      const words = await transcribe(out, { model: store.getSettings().whisperModel, onProgress: (k, m) => update(0.2 + k * 0.8, m) });
      store.updateProject(id, { words, timing: 'whisper' });
      return { duration, words: words.length };
    });
    return ok(res, jobView(job));
  }

  if (sub === 'writer' && M === 'POST') {
    const step = parts[3];
    const b = await readJson(req);
    // Options carry over from step to step, and are saved now: in copy & paste mode nothing else is saved until the reply.
    const o = { ...(p.writer?.options || {}), ...(b.options || {}) };
    const writer = { ...(p.writer || {}), options: o };
    if (b.options) store.updateProject(id, { writer });
    const job = startJob('writer-' + step, id, async (update) => {
      update(0.1, 'Writing');
      const onProgress = (c) => update(Math.min(0.9, 0.1 + c / 20000), `Writing (${Math.round(c / 1000)}k characters)`);
      if (step === 'ideas') {
        const r = await askJson(prompts.WRITER_SYSTEM, prompts.ideasPrompt({ ...o, more: b.more ? (writer.ideas || []).map((i) => i.title).join('; ') : '' }), { manualReply: b.manualReply, onProgress });
        const ideas = (Array.isArray(r.ideas) ? r.ideas : []).filter((i) => i && i.title);
        writer.ideas = b.more ? [...(writer.ideas || []), ...ideas] : ideas;
      } else if (step === 'breakdown') {
        const idea = b.idea || writer.idea;
        if (!idea) throw new Error('Pick an idea first');
        writer.idea = idea;
        writer.breakdown = await askJson(prompts.WRITER_SYSTEM, prompts.breakdownPrompt({ ...o, idea, notes: b.notes }), { manualReply: b.manualReply, onProgress });
      } else if (step === 'script') {
        const breakdown = b.breakdown || writer.breakdown;
        if (!breakdown) throw new Error('Approve a story breakdown first');
        writer.breakdown = breakdown;
        const r = await askJson(prompts.WRITER_SYSTEM, prompts.scriptPrompt({ ...o, breakdown, notes: b.notes, previous: b.revise ? p.script : '' }), { manualReply: b.manualReply, onProgress });
        if (!r.script) throw new Error('The reply did not contain a script');
        writer.scriptTitle = r.title;
        store.updateProject(id, { script: String(r.script).trim(), title: p.title === 'Untitled video' && r.title ? r.title : p.title });
      } else throw new Error('Unknown writer step');
      store.updateProject(id, { writer });
      return { writer };
    });
    return ok(res, jobView(job));
  }

  if (sub === 'storyboard' && M === 'POST') {
    if (busy(id, 'storyboard')) return fail(res, 409, 'Already directing');
    const b = await readJson(req);
    const job = startJob('storyboard', id, (update) => generateStoryboard(store.loadProject(id), b, update));
    return ok(res, jobView(job));
  }

  if (sub === 'revise' && M === 'POST') {
    const b = await readJson(req);
    const shot = p.storyboard?.shots?.find((s) => s.id === b.shotId);
    if (!shot) return fail(res, 404, 'Shot not found');
    if (!String(b.instruction || '').trim() && !b.manualReply) return fail(res, 400, 'Describe the change you want');
    const job = startJob('revise', id, async (update) => {
      update(0.2, 'Reworking the shot');
      const o = directorOpts(p);
      const r = await askJson(prompts.directorSystem(sfxLib(p)), prompts.reviseShotPrompt({ ...o, cast: p.storyboard.cast, shot, instruction: b.instruction }), { manualReply: b.manualReply });
      const next = { ...(r.shot || r), id: shot.id, start: shot.start, end: shot.end };
      const fresh = store.loadProject(id);
      const shots = fresh.storyboard.shots.map((s) => (s.id === shot.id ? next : s));
      const { story, warnings } = validateStoryboard({ ...fresh.storyboard, shots }, { duration: projectDuration(fresh), sfxIds: sfxIds(fresh) });
      store.updateProject(id, { storyboard: story, warnings });
      return { shot: story.shots.find((s) => s.id === shot.id), warnings };
    });
    return ok(res, jobView(job));
  }

  if (sub === 'mix' && M === 'POST') {
    if (!p.storyboard) return fail(res, 400, 'No storyboard yet');
    const job = startJob('mix', id, async (update) => { await buildPreviewMix(p, update); return { file: 'preview-mix.wav' }; });
    return ok(res, jobView(job));
  }

  if (sub === 'render' && M === 'POST') {
    if (!p.storyboard?.shots?.length) return fail(res, 400, 'Create a storyboard first');
    if (busy(id, 'render')) return fail(res, 409, 'A render is already running');
    const b = await readJson(req);
    const preview = !!b.preview;
    const job = startJob('render', id, async (update, signal) => {
      const name = preview ? 'preview.mp4' : `${p.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'video'}.mp4`;
      const out = store.projectFile(id, path.join('out', name));
      const r = await renderVideo({
        project: p, words: p.words || [], duration: projectDuration(p),
        voiceFile: voicePath(p), musicFile: musicPath(p), out,
        from: preview ? Number(b.from) || 0 : 0, to: preview ? (b.to != null ? Number(b.to) : Math.min(projectDuration(p), (Number(b.from) || 0) + 20)) : undefined,
        scale: preview ? 0.5 : 1, preset: preview ? 'veryfast' : 'fast',
        workers: store.getSettings().workers || undefined,
        onProgress: update, signal,
      });
      const rel = 'out/' + name;
      const fresh = store.loadProject(id);
      const renders = [{ file: rel, preview, at: Date.now(), width: r.width, height: r.height, duration: r.duration, seconds: r.seconds }, ...(fresh.renders || []).filter((x) => x.file !== rel)].slice(0, 12);
      store.updateProject(id, { renders });
      return { ...r, file: rel };
    });
    return ok(res, jobView(job));
  }

  if (sub === 'still' && M === 'POST') {
    const b = await readJson(req);
    const out = store.projectFile(id, path.join('out', 'still.png'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await renderStill(p, p.words || [], Number(b.t) || 0, out, 1);
    return ok(res, { file: 'out/still.png' });
  }

  return fail(res, 404, 'Unknown endpoint');
}

const server = http.createServer(async (req, res) => {
  try {
    const host = String(req.headers.host || '');
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return fail(res, 403, 'Stickframe only accepts local connections');
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname.startsWith('/api/')) {
      const tok = req.headers['x-sf-token'] || url.searchParams.get('k');
      if (tok !== TOKEN) return fail(res, 401, 'Reload the page: your session token is out of date');
      return await api(req, res, url);
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return serveIndex(res);
    if (url.pathname.startsWith('/engine/')) return staticFile(req, res, path.join(ROOT, 'engine'), url.pathname.slice(8));
    if (url.pathname.startsWith('/fonts/')) {
      const f = url.pathname.slice(7);
      const map = { 'lilita.woff2': '@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff2', 'anton.woff2': '@fontsource/anton/files/anton-latin-400-normal.woff2', 'rubik-400.woff2': '@fontsource/rubik/files/rubik-latin-400-normal.woff2', 'rubik-600.woff2': '@fontsource/rubik/files/rubik-latin-600-normal.woff2', 'rubik-700.woff2': '@fontsource/rubik/files/rubik-latin-700-normal.woff2', 'rubik-800.woff2': '@fontsource/rubik/files/rubik-latin-800-normal.woff2' };
      if (!map[f]) return fail(res, 404, 'Not found');
      try { return sendFile(req, res, require.resolve(map[f])); } catch { return fail(res, 404, 'Not found'); }
    }
    return staticFile(req, res, path.join(ROOT, 'public'), url.pathname.slice(1));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 500, e.message || 'Server error');
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Is Stickframe already running? Open http://localhost:${PORT}\nOr start on another port: STICKFRAME_PORT=4871 npm start\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  const ff = findFfmpeg();
  console.log(`\n  Stickframe ${PKG.version} is running at ${url}\n  Projects are saved in ${store.HOME}\n${ff ? '' : '\n  WARNING: ffmpeg was not found. Install it to transcribe and render (see README).\n'}\n  Press Ctrl+C to stop.\n`);
  if (!process.argv.includes('--no-open') && !process.env.STICKFRAME_NO_OPEN) openInOs(url);
});
