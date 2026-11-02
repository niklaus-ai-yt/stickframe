// Where Stickframe keeps its data, plus settings and project storage.
// Everything lives in one folder (default: ~/Stickframe, override with STICKFRAME_HOME).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const HOME = process.env.STICKFRAME_HOME || path.join(os.homedir(), 'Stickframe');
export const PROJECTS = path.join(HOME, 'projects');
export const MODELS = path.join(HOME, 'models');
const SETTINGS_FILE = path.join(HOME, 'settings.json');

fs.mkdirSync(PROJECTS, { recursive: true });
fs.mkdirSync(MODELS, { recursive: true });

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  claudeMode: 'manual', // 'manual' (copy & paste into any chatbot) | 'mcp' (the Claude app drives Stickframe)
  whisperModel: 'base.en',
  workers: 0, // 0 = automatic
};

export function getSettings() {
  try {
    const saved = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    return { ...saved, claudeMode: saved.claudeMode === 'mcp' ? 'mcp' : 'manual' };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  for (const k of Object.keys(next)) if (!(k in DEFAULT_SETTINGS)) delete next[k];
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

// Settings as sent to the browser.
export function publicSettings() {
  return getSettings();
}

// ---------- projects ----------
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function projectDir(id) {
  if (!ID_RE.test(String(id))) throw new Error('Invalid project id');
  return path.join(PROJECTS, id);
}

function slugify(s) {
  return String(s || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';
}

export function listProjects() {
  const out = [];
  for (const id of fs.readdirSync(PROJECTS)) {
    try {
      const p = loadProject(id);
      out.push({ id: p.id, title: p.title, updated: p.updated, created: p.created, aspect: p.aspect, duration: p.voice?.duration || p.duration || 0, shots: p.storyboard?.shots?.length || 0, hasRender: !!(p.renders && p.renders.length), look: p.look });
    } catch { /* skip foreign folders */ }
  }
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export function createProject(fields = {}) {
  const base = slugify(fields.title);
  let id = base;
  while (fs.existsSync(path.join(PROJECTS, id))) id = `${base}-${crypto.randomBytes(2).toString('hex')}`;
  const now = Date.now();
  const p = {
    id,
    title: fields.title || 'Untitled video',
    created: now,
    updated: now,
    aspect: '16:9',
    resolution: '1080p',
    fps: 30,
    look: 'ember',
    captions: false,
    music: { mode: 'auto', volume: 0.5 },
    sfx: true,
    script: '',
    writer: {},
    voice: null,
    words: [],
    storyboard: null,
    warnings: [],
    renders: [],
    ...fields,
  };
  fs.mkdirSync(projectDir(id), { recursive: true });
  saveProject(p);
  return p;
}

export function loadProject(id) {
  return JSON.parse(fs.readFileSync(path.join(projectDir(id), 'project.json'), 'utf8'));
}

export function saveProject(p) {
  p.updated = Date.now();
  const dir = projectDir(p.id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'project.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
  fs.renameSync(tmp, path.join(dir, 'project.json'));
  return p;
}

export function updateProject(id, patch) {
  const p = loadProject(id);
  Object.assign(p, patch);
  return saveProject(p);
}

export function deleteProject(id) {
  fs.rmSync(projectDir(id), { recursive: true, force: true });
}

// Resolve a file name inside a project folder, refusing anything that escapes it.
export function projectFile(id, name) {
  const dir = projectDir(id);
  const full = path.resolve(dir, String(name));
  if (!full.startsWith(dir + path.sep)) throw new Error('Invalid file path');
  return full;
}
