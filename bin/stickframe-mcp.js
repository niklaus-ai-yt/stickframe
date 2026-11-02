#!/usr/bin/env node
// StickFrame's MCP server, for the Claude desktop app (installed as the Claude extension from Settings).
// It speaks MCP over stdio and drives the local StickFrame app through its HTTP API, starting it if needed.
// Claude does the writing and directing itself: each step hands Claude StickFrame's prompt, and Claude
// sends its reply back, the same prompts the copy & paste mode shows. Nothing here calls an AI or the internet.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../server/mcp-tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PORT = Number(process.env.STICKFRAME_PORT || 4870);
const BASE = `http://127.0.0.1:${PORT}`;
const log = (...a) => console.error('[stickframe-mcp]', ...a);

// ---------------------------------------------------------------- the local app
let token = null;

async function readToken() {
  const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) });
  const m = /name="sf-token" content="([0-9a-f]+)"/.exec(await res.text());
  if (!m) throw new Error(`port ${PORT} is in use by something other than StickFrame`);
  return m[1];
}

async function connect() {
  if (token) return token;
  try {
    token = await readToken();
  } catch (e) {
    if (e.message.startsWith('port ')) throw e;
    log('starting StickFrame');
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js'), '--no-open'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
    child.unref();
    for (let i = 0; i < 60 && !token; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { token = await readToken(); } catch { /* still starting */ }
    }
    if (!token) throw new Error('StickFrame did not start. Open it with start-windows (or the start script) to see why.');
  }
  await call('POST', '/mcp/hello', {}).catch(() => {});
  return token;
}

async function call(method, route, body, headers = {}) {
  const init = { method, headers: { 'x-sf-token': token, ...headers } };
  if (body != null) {
    if (Buffer.isBuffer(body)) init.body = body;
    else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  }
  let res = await fetch(`${BASE}/api${route}`, init);
  if (res.status === 401 || res.status === 403) { // the app restarted with a new token
    token = await readToken();
    init.headers['x-sf-token'] = token;
    res = await fetch(`${BASE}/api${route}`, init);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Follows a job until it finishes, needs a reply ("manual"), or runs past `wait` ms.
async function follow(job, wait = 600e3) {
  const end = Date.now() + wait;
  while (job.status === 'running' && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 700));
    job = await call('GET', `/jobs/${job.id}`);
  }
  if (job.status === 'error') throw new Error(job.error);
  if (job.status === 'cancelled') throw new Error('cancelled');
  return job;
}

const project = (id) => call('GET', `/projects/${encodeURIComponent(id)}`);
const url = (id) => (id ? `${BASE}/#/p/${id}` : BASE);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function promptText(job, next) {
  return `${job.result.prompt}\n\n---\nStickFrame: answer the prompt above yourself, in the exact format it asks for, then call ${next}.`;
}

async function writerBody(a, p) {
  const options = {};
  for (const k of ['niche', 'format', 'minutes', 'topic']) if (a[k] != null) options[k] = a[k];
  const body = { options, notes: a.notes };
  if (a.step === 'breakdown') {
    const ideas = p.writer?.ideas || [];
    const n = a.idea_number ?? (p.writer?.idea ? ideas.findIndex((i) => i.title === p.writer.idea.title) + 1 : 0);
    if (!ideas[n - 1]) throw new Error(ideas.length ? `There is no idea number ${n}. Pick 1 to ${ideas.length}.` : 'Get ideas first (writer_prompt step "ideas").');
    body.idea = ideas[n - 1];
  }
  return body;
}

// ---------------------------------------------------------------- tools
const handlers = {
  async stickframe_status() {
    const s = await call('GET', '/status');
    return `StickFrame ${s.version} is running at ${BASE}\nData folder: ${s.home}\nffmpeg: ${s.ffmpeg ? s.ffmpeg.version : 'NOT FOUND (install it: winget install ffmpeg / brew install ffmpeg)'}\nAI mode: ${s.settings.claudeMode === 'mcp' ? 'Claude (MCP)' : 'copy & paste'}\nSpeech model: ${s.settings.whisperModel}`;
  },
  async list_projects() {
    const list = await call('GET', '/projects');
    return list.length ? list.map((p) => `${p.id}  ${p.title}  (${p.aspect}, ${p.shots} shots${p.hasRender ? ', rendered' : ''})`).join('\n') : 'No projects yet.';
  },
  async create_project(a) {
    const p = await call('POST', '/projects', { title: a.title, aspect: a.aspect });
    const patch = {};
    for (const k of ['resolution', 'look', 'captions']) if (a[k] != null) patch[k] = a[k];
    if (Object.keys(patch).length) await call('PATCH', `/projects/${p.id}`, patch);
    return `Created "${a.title}". Project id: ${p.id}\nOpen it: ${url(p.id)}`;
  },
  async get_project(a) {
    const p = await project(a.project);
    const w = p.writer || {};
    const lines = [
      `${p.title} (${p.id})`,
      `Settings: ${p.aspect}, ${p.resolution}, ${p.fps} fps, look ${p.look}, captions ${p.captions ? 'on' : 'off'}, music ${p.music?.mode || 'auto'} at ${Math.round((p.music?.volume ?? 0.5) * 100)}%, sound effects ${p.sfx !== false ? 'on' : 'off'}`,
      `Writer: ${w.ideas?.length ? `${w.ideas.length} ideas` : 'no ideas yet'}${w.idea ? `; chosen: ${w.idea.title}` : ''}${w.breakdown ? '; breakdown done' : ''}`,
      `Script: ${p.script ? `${p.script.split(/\s+/).length} words` : 'none yet'}`,
      `Voiceover: ${p.voice?.duration ? fmt(p.voice.duration) : 'none yet'}; timed words: ${p.words?.length || 0}`,
      `Storyboard: ${p.storyboard?.shots?.length ? `${p.storyboard.shots.length} shots` : 'not directed yet'}`,
      `Renders: ${(p.renders || []).map((r) => r.file).join(', ') || 'none'}`,
      `Open it: ${url(p.id)}`,
    ];
    if (w.ideas?.length && !w.breakdown) lines.push('', 'Ideas:', ...w.ideas.map((i, k) => `${k + 1}. ${i.title}: ${i.premise || ''}`));
    if (p.script) lines.push('', 'Script:', p.script);
    return lines.join('\n');
  },
  async update_project(a) {
    const p = await project(a.project);
    const patch = {};
    for (const k of ['title', 'aspect', 'resolution', 'fps', 'look', 'captions', 'sfx', 'script']) if (a[k] != null) patch[k] = a[k];
    if (a.music_mode != null || a.music_volume != null) patch.music = { ...p.music, ...(a.music_mode != null ? { mode: a.music_mode } : {}), ...(a.music_volume != null ? { volume: Math.max(0, Math.min(1, a.music_volume)) } : {}) };
    if (a.director_notes != null) patch.brief = a.director_notes;
    await call('PATCH', `/projects/${p.id}`, patch);
    return `Updated ${Object.keys(patch).join(', ')}.`;
  },
  async writer_prompt(a) {
    const p = await project(a.project);
    const job = await follow(await call('POST', `/projects/${p.id}/writer/${a.step}`, await writerBody(a, p)));
    if (job.status !== 'manual') throw new Error('StickFrame did not return a prompt.');
    return promptText(job, `writer_submit with step "${a.step}"`);
  },
  async writer_submit(a) {
    const p = await project(a.project);
    const body = { ...(await writerBody(a, p)), manualReply: a.reply };
    const job = await follow(await call('POST', `/projects/${p.id}/writer/${a.step}`, body));
    const w = job.result.writer;
    if (a.step === 'ideas') return `Saved ${w.ideas.length} ideas:\n${w.ideas.map((i, k) => `${k + 1}. ${i.title}`).join('\n')}`;
    if (a.step === 'breakdown') return `Breakdown saved: ${w.breakdown.title || w.idea?.title}`;
    return `Script saved:\n\n${(await project(p.id)).script}`;
  },
  async set_voice(a) {
    const file = a.file.replace(/^~(?=[\\/])/, os.homedir());
    if (!fs.existsSync(file)) throw new Error(`No file at ${file}`);
    const p = await call('PUT', `/projects/${encodeURIComponent(a.project)}/upload?kind=voice&name=${encodeURIComponent(path.basename(file))}`, fs.readFileSync(file));
    return `Voiceover added: ${path.basename(file)}, ${fmt(p.voice.duration)}. Next: transcribe.`;
  },
  async draft_voice(a) {
    const job = await follow(await call('POST', `/projects/${encodeURIComponent(a.project)}/draft-voice`, {}));
    return `Draft voice made: ${job.result.duration.toFixed(1)} s, ${job.result.words} words timed.`;
  },
  async transcribe(a) {
    const job = await follow(await call('POST', `/projects/${encodeURIComponent(a.project)}/transcribe`, { model: a.model }));
    return `${job.result.words} words timed on this computer.`;
  },
  async director_prompt(a) {
    const job = await follow(await call('POST', `/projects/${encodeURIComponent(a.project)}/storyboard`, {}));
    if (job.status !== 'manual') return `Directed: ${job.result.shots} shots.`;
    return promptText(job, 'director_submit with your whole reply');
  },
  async director_submit(a) {
    const job = await follow(await call('POST', `/projects/${encodeURIComponent(a.project)}/storyboard`, { manualReply: a.storyboard }));
    if (job.status === 'manual') throw new Error(job.result.issue || 'StickFrame could not use that reply. Send the complete storyboard JSON.');
    const warn = job.result.warnings || [];
    return `Storyboard saved: ${job.result.shots} shots.${warn.length ? `\nWarnings:\n${warn.map((w) => `- ${w}`).join('\n')}` : ''}\nPreview it: ${url(a.project)}`;
  },
  async list_shots(a) {
    const p = await project(a.project);
    const shots = p.storyboard?.shots || [];
    if (!shots.length) return 'No storyboard yet.';
    return shots.map((s) => `${s.id}  ${s.start.toFixed(1)}-${s.end.toFixed(1)} s  ${s.set || ''}  ${s.camera?.shot || ''}  ${(s.actors || []).map((x) => `${x.id}:${x.pose || ''}`).join(' ')}  ${(s.text || []).map((t) => `"${t.text || t.type}"`).join(' ')}`).join('\n');
  },
  async revise_prompt(a) {
    const job = await follow(await call('POST', `/projects/${encodeURIComponent(a.project)}/revise`, { shotId: a.shot, instruction: a.change }));
    if (job.status !== 'manual') return `${a.shot} updated.`;
    return promptText(job, 'revise_submit with the same shot and change');
  },
  async revise_submit(a) {
    await follow(await call('POST', `/projects/${encodeURIComponent(a.project)}/revise`, { shotId: a.shot, instruction: a.change, manualReply: a.reply }));
    return `${a.shot} updated. Nothing else changed.`;
  },
  async render(a) {
    const body = { preview: !!a.preview };
    if (a.from != null) body.from = a.from;
    if (a.to != null) body.to = a.to;
    const job = await follow(await call('POST', `/projects/${encodeURIComponent(a.project)}/render`, body), 55e3);
    return renderResult(job);
  },
  async job_status(a) {
    return renderResult(await follow(await call('GET', `/jobs/${encodeURIComponent(a.job)}`), 55e3));
  },
  async open_in_browser(a) {
    const target = url(a.project);
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [target]];
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return `Opened ${target}`;
  },
};

async function renderResult(job) {
  if (job.status === 'running') return `Still rendering: ${Math.round(job.progress * 100)}% (${job.message}). Job id: ${job.id}. Check again with job_status.`;
  const s = await call('GET', '/status');
  return `Done. The video is at ${path.join(s.home, 'projects', job.projectId, job.result.file)}${job.result.seconds ? ` (rendered in ${Math.round(job.result.seconds)} s)` : ''}.`;
}

// ---------------------------------------------------------------- MCP over stdio (JSON-RPC, one message per line)
function send(msg) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n'); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (id == null) return; // notifications need no answer
  try {
    if (method === 'initialize') {
      return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stickframe', version: PKG.version },
        instructions: 'StickFrame makes stick-figure videos on this computer. Order: create_project, writer_prompt/writer_submit for ideas, breakdown and script (show the user the script and wait for approval), then the user makes the voiceover; set_voice, transcribe, update_project for settings, director_prompt/director_submit, render with preview first, then the full render. Ask the user before choices that are theirs (resolution, music, captions, look).' } });
    }
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const fn = handlers[params?.name];
      if (!fn) return send({ id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
      try {
        await connect();
        const text = await fn(params.arguments || {});
        return send({ id, result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        return send({ id, result: { content: [{ type: 'text', text: `StickFrame: ${e.message}` }], isError: true } });
      }
    }
    send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ id, error: { code: -32603, message: e.message } });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
connect().catch((e) => log(e.message)); // say hello early, so Settings shows Claude as connected
