// Stickframe Studio front end. Plain ES modules, no build step.
import { compileFilm, renderFrame, LOOKS } from '/engine/index.js';

const TOKEN = document.querySelector('meta[name="sf-token"]').content;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const browserEnv = { createCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; } };

const state = { status: null, projects: [], project: null, tab: 'voice', shot: null, player: null, writerBusy: false };

// ------------------------------------------------------------ api
async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'X-SF-Token': TOKEN, ...(raw ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const fileUrl = (p, name, extra = '') => `/api/projects/${p.id}/file/${encodeURIComponent(name).replace(/%2F/g, '/')}?k=${TOKEN}&v=${p.updated}${extra}`;

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3500);
}

// Poll a background job until it finishes. Handles copy & paste mode.
async function runJob(startFn, { progressEl, onProgress, retry } = {}) {
  let job = await startFn();
  const bar = progressEl ? $('.progress > div', progressEl) : null;
  const msg = progressEl ? $('.job-msg', progressEl) : null;
  if (progressEl) progressEl.hidden = false;
  while (job.status === 'running') {
    if (bar) bar.style.width = `${Math.round(job.progress * 100)}%`;
    if (msg) msg.textContent = job.message || '';
    onProgress?.(job);
    await new Promise((r) => setTimeout(r, 600));
    job = await api(`/jobs/${job.id}`);
  }
  if (bar) bar.style.width = job.status === 'done' ? '100%' : bar.style.width;
  if (msg) msg.textContent = job.status === 'done' ? job.message || 'Done' : job.error || job.status;
  if (job.status === 'manual') {
    const reply = await manualModal(job.result.prompt, job.result);
    if (reply == null) throw new Error('Cancelled');
    if (!retry) throw new Error('This step does not support copy & paste');
    return runJob(() => retry(reply, job.result), { progressEl, onProgress, retry });
  }
  if (job.status === 'error') throw new Error(job.error);
  if (job.status === 'cancelled') throw new Error('Cancelled');
  return job.result;
}

const progressBox = (id) => `<div class="job" id="${id}" hidden><div class="progress"><div></div></div><div class="job-msg"></div></div>`;

// ------------------------------------------------------------ modal
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
}
function closeModal() {
  $('#modal').hidden = true;
  $('#modalBody').innerHTML = '';
  state.modalResolve?.(null);
  state.modalResolve = null;
}

// A one-line question in the app's own window (the browser's prompt() can't be styled or recorded).
// Resolves to the text, or null when cancelled.
function askText(title, hint, value = '') {
  return new Promise((resolve) => {
    openModal(`
      <h2>${esc(title)}</h2>
      <p class="muted">${esc(hint)}</p>
      <input type="text" id="askInput" value="${esc(value)}" style="width:100%">
      <div class="row end" style="margin-top:14px"><button class="btn ghost" data-action="close-modal">Cancel</button><button class="btn primary" id="askOk">OK</button></div>`);
    state.modalResolve = resolve;
    const input = $('#askInput');
    input.focus();
    input.select();
    const ok = () => { state.modalResolve = null; const v = input.value; closeModal(); resolve(v); };
    $('#askOk').onclick = ok;
    input.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  });
}

// The strip of parts in the copy & paste window. Parts already reached can be reopened to retry them.
function partsStrip(info) {
  const mark = { ok: '✓', short: '!', broken: '!' };
  const reached = (info.parts.find((x) => x.status !== 'ok') || info.parts[info.parts.length - 1]).n;
  return `<div class="parts-strip">${info.parts.map((x) => `<button class="part-chip ${x.status} ${x.n === info.part ? 'on' : ''}" data-part="${x.n}" ${x.n > reached ? 'disabled' : ''} title="${fmtTime(x.start)} to ${fmtTime(x.end)}">${mark[x.status] || ''} ${x.n}</button>`).join('')}</div>`;
}

// Resolves to the pasted reply. For a video in parts it can also resolve to { part } or { part, acceptShort }.
function manualModal(prompt, info = {}) {
  const inParts = !!info.part;
  return new Promise((resolve) => {
    openModal(`
      <h2>${inParts ? `Part ${info.part} of ${info.total}` : 'Copy &amp; paste with any AI chatbot'}</h2>
      ${inParts ? `<p class="muted">Long videos go one part at a time, so a free chatbot can finish each reply. This part is ${fmtTime(info.start)} to ${fmtTime(info.end)}. Your progress is saved after every reply.</p>${partsStrip(info)}` : ''}
      ${info.issue ? `<div class="warn-box" id="mIssue" style="margin-bottom:10px"><b>Part ${info.part} needs another try.</b> ${esc(info.issue)} Copy the prompt again, ideally in a new chat, and paste the new reply.${info.canKeep ? ' <button class="btn ghost" id="mKeep">Keep it anyway</button>' : ''}</div>` : ''}
      ${state.status.settings.claudeMode === 'mcp' ? '<div class="note small" style="margin-bottom:10px">You are in Claude app mode: you can skip this window and ask Claude to do this step for you.</div>' : ''}
      <p class="muted">1. Copy this prompt and send it to any AI chatbot. 2. Paste the full reply below.</p>
      <div class="row" style="margin-bottom:8px"><button class="btn gold" id="mCopy">Copy prompt</button><span class="dim small">${Math.round(prompt.length / 1000)}k characters</span></div>
      <textarea class="code" rows="6" readonly>${esc(prompt)}</textarea>
      <label class="field" style="margin-top:12px">The chatbot's reply<textarea class="code" id="mReply" rows="8" placeholder="Paste the whole reply here (the part with \`\`\`json is what matters)"></textarea></label>
      <div class="row end" style="margin-top:12px"><button class="btn ghost" data-action="close-modal">Cancel</button><button class="btn primary" id="mUse">Use this reply</button></div>`);
    state.modalResolve = resolve;
    $('#mCopy').onclick = async () => { await navigator.clipboard.writeText(prompt); toast('Prompt copied', 'ok'); };
    const finish = (answer) => { state.modalResolve = null; closeModal(); resolve(answer); };
    $('#mUse').onclick = () => {
      const v = $('#mReply').value.trim();
      if (!v) return toast('Paste the reply first', 'err');
      finish(v);
    };
    $$('.part-chip').forEach((b) => (b.onclick = () => { if (+b.dataset.part !== info.part) finish({ part: +b.dataset.part }); }));
    if ($('#mKeep')) $('#mKeep').onclick = () => finish({ part: info.part, acceptShort: true });
  });
}

function settingsModal() {
  const s = state.status.settings;
  const mcp = state.status.mcp || {};
  openModal(`
    <h2>Settings</h2>
    <h3 style="margin-top:14px">How Stickframe talks to an AI</h3>
    <div class="mode-cards two" id="modeCards">
      <button class="mode-card ${s.claudeMode === 'manual' ? 'on' : ''}" data-mode="manual"><b>Copy &amp; paste</b><span>Free, no setup. Stickframe gives you prompts to paste into any AI chatbot.</span></button>
      <button class="mode-card ${s.claudeMode === 'mcp' ? 'on' : ''}" data-mode="mcp"><b>Claude app (MCP)</b><span>Uses your Claude plan. Claude drives Stickframe for you, on this computer.</span></button>
    </div>
    <div id="mcpOpts" class="card" style="margin-top:12px">
      <ol class="steps-list">
        <li>Get the Claude desktop app from <span class="mono">claude.com/download</span> and sign in. A paid Claude plan works best for whole videos.</li>
        <li><a class="btn gold small" id="sExt" href="/api/mcp/extension?k=${TOKEN}" download="stickframe.mcpb">Download the Claude extension</a></li>
        <li>Double-click <span class="mono">stickframe.mcpb</span>. Claude opens and asks to install Stickframe. Click Install.</li>
        <li>In Claude, ask for a video, for example: <i>"Make a one-minute What If video with Stickframe."</i></li>
      </ol>
      <div class="small" id="sMcpState">${mcp.connected ? '<span style="color:var(--good)">● Claude is connected</span>' : '<span class="muted">○ Claude hasn\'t connected yet</span>'}</div>
    </div>
    <div class="stack" style="margin-top:14px">
      <div class="grid2">
        <label class="field">Speech model<select id="sWhisper">${state.status.whisperModels.map((m) => `<option ${s.whisperModel === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="field">Render workers<input type="number" id="sWorkers" min="0" max="32" value="${s.workers || 0}"></label>
      </div>
      <p class="dim small">Speech models ending in ".en" are English-only and fastest; "base"/"small" handle other languages. Render workers 0 = automatic. Your data is stored in <span class="mono">${esc(state.status.home)}</span>.</p>
    </div>
    <div class="row between" style="margin-top:16px">
      <div class="row"><button class="btn" id="sTest">Test connection</button><span id="sTestOut" class="small muted"></span></div>
      <div class="row"><button class="btn ghost" data-action="close-modal">Close</button><button class="btn primary" id="sSave">Save</button></div>
    </div>`);
  let mode = s.claudeMode;
  const sync = () => { $('#mcpOpts').hidden = mode !== 'mcp'; $$('#modeCards .mode-card').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode)); };
  sync();
  $$('#modeCards .mode-card').forEach((b) => (b.onclick = () => { mode = b.dataset.mode; sync(); }));
  const save = async () => {
    const body = { claudeMode: mode, whisperModel: $('#sWhisper').value, workers: Number($('#sWorkers').value) || 0 };
    state.status.settings = await api('/settings', { method: 'POST', body });
  };
  $('#sSave').onclick = async () => { await save(); closeModal(); toast('Settings saved', 'ok'); if (!state.project) renderHome(); };
  $('#sTest').onclick = async () => {
    $('#sTestOut').innerHTML = '<span class="spinner"></span> testing…';
    await save();
    const r = await api('/claude/test', { method: 'POST' });
    $('#sTestOut').innerHTML = r.ok ? `<span style="color:var(--good)">✓ ${esc(r.note)}</span>` : `<span style="color:var(--bad)">✗</span> ${esc(r.note)}`;
  };
}

// ------------------------------------------------------------ sidebar & routing
async function refreshProjects() {
  state.projects = await api('/projects');
  $('#projectList').innerHTML = state.projects.length
    ? state.projects.map((p) => `<button class="project-link ${state.project?.id === p.id ? 'active' : ''}" data-open="${esc(p.id)}"><span class="t">${esc(p.title)}</span><span class="m">${p.aspect} · ${p.duration ? fmtTime(p.duration) : 'no audio'} · ${p.shots} shots</span></button>`).join('')
    : '<div class="dim small" style="padding:6px 8px">No videos yet.</div>';
}

async function openProject(id, tab) {
  state.player?.destroy();
  state.player = null;
  state.project = await api(`/projects/${id}`);
  state.shot = null;
  const p = state.project;
  state.tab = tab || (p.renders?.length ? 'preview' : p.storyboard ? 'storyboard' : p.words?.length || p.voice ? 'voice' : p.script ? 'voice' : 'script');
  location.hash = `#/p/${id}`;
  await refreshProjects();
  renderProject();
}

async function reloadProject() {
  state.project = await api(`/projects/${state.project.id}`);
  return state.project;
}

async function patchProject(patch) {
  state.project = { ...(await api(`/projects/${state.project.id}`, { method: 'PATCH', body: patch })), duration: state.project.duration, outputSize: state.project.outputSize };
  return reloadProject();
}

// ------------------------------------------------------------ home
function renderHome() {
  state.player?.destroy();
  state.player = null;
  state.project = null;
  location.hash = '';
  refreshProjects();
  const st = state.status;
  const s = st.settings;
  const modeLabel = { mcp: 'Claude app (MCP)', manual: 'Copy & paste' }[s.claudeMode];
  $('#main').innerHTML = `
  <div class="page">
    <section class="hero">
      <div>
        <h1>Turn a voiceover into an <span class="hl">animated stick-figure</span> video.</h1>
        <p>Any AI chatbot can write the script and direct every shot. Stickframe animates it, adds music and sound effects, and exports a finished MP4 for YouTube, Shorts or TikTok.</p>
        <div class="row" style="margin-top:16px"><button class="btn primary" data-action="new-project">+ Start a new video</button><button class="btn" data-action="demo">▶ Open the demo</button></div>
      </div>
      <canvas id="heroCanvas" width="960" height="540"></canvas>
    </section>
    <div class="steps-strip">
      <div class="step-tile"><span class="n">1</span><b>Script</b><span class="muted small">Brainstorm ideas, approve a story, get a narration script. Optional.</span></div>
      <div class="step-tile"><span class="n">2</span><b>Voice</b><span class="muted small">Drop in your voiceover from any TTS tool. Words are timed automatically.</span></div>
      <div class="step-tile"><span class="n">3</span><b>Storyboard</b><span class="muted small">An AI directs every shot. Tweak any scene in plain English.</span></div>
      <div class="step-tile"><span class="n">4</span><b>Export</b><span class="muted small">Pick a look, preview instantly, render 720p to 4K with music &amp; SFX.</span></div>
    </div>
    <div class="grid2">
      <div class="card">
        <h3>Setup check</h3>
        <div class="checklist">
          <div class="check-item"><span class="dot ${st.ffmpeg ? 'ok' : 'bad'}"></span><div><b>ffmpeg</b><div class="small muted">${st.ffmpeg ? `Found (${esc(st.ffmpeg.version)})` : 'Not found. Install ffmpeg and restart Stickframe: Windows <span class="mono">winget install ffmpeg</span>, macOS <span class="mono">brew install ffmpeg</span>, Linux <span class="mono">sudo apt install ffmpeg</span>.'}</div></div></div>
          <div class="check-item"><span class="dot ${s.claudeMode === 'mcp' && !state.status.mcp?.connected ? 'bad' : 'ok'}"></span><div><b>AI: ${esc(modeLabel)}</b><div class="small muted">${s.claudeMode === 'mcp' ? (state.status.mcp?.connected ? 'Claude is connected. Ask it for a video in the Claude app.' : 'Install the Claude extension from Settings, then open the Claude app.') : 'You will copy prompts into any AI chatbot and paste replies back.'} <a href="#" data-action="open-settings">Change</a></div></div></div>
          <div class="check-item"><span class="dot ok"></span><div><b>Speech model: ${esc(s.whisperModel)}</b><div class="small muted">Runs on this computer. Downloads once (about 290 MB) on first transcription.</div></div></div>
        </div>
      </div>
      <div class="card">
        <h3>Recent videos</h3>
        ${state.projects.length ? `<div class="recent">${state.projects.slice(0, 4).map((p) => `<button class="recent-card" data-open="${esc(p.id)}"><b>${esc(p.title)}</b><div class="small muted">${p.aspect} · ${p.shots} shots${p.hasRender ? ' · rendered' : ''}</div></button>`).join('')}</div>` : '<div class="empty"><div class="big">Nothing here yet</div>Start a new video or open the demo.</div>'}
      </div>
    </div>
  </div>`;
  heroAnimation($('#heroCanvas'));
}

let heroRaf = 0;
function heroAnimation(canvas) {
  cancelAnimationFrame(heroRaf);
  const story = {
    cast: [{ id: 'you', color: '#ff5a3c', wear: ['hoodie'] }, { id: 'pal', color: '#ffc23a', wear: ['cap'] }],
    shots: [
      { id: 'a', start: 0, end: 4, set: 'city', light: 'sunset', camera: { shot: 'wide', move: 'push' }, actors: [{ id: 'you', x: 0.38, pose: 'wave', mood: 'joy', face: 'right' }, { id: 'pal', x: 0.64, pose: 'cheer', mood: 'excited', face: 'left' }], fx: ['sparkles'], text: [{ type: 'title', text: 'Stickframe', sub: 'free and open source', at: 0.3 }] },
      { id: 'b', start: 4, end: 7, set: 'blueprint', camera: { shot: 'wide', move: 'pull' }, actors: [{ id: 'you', x: 0.25, pose: 'present', mood: 'happy', face: 'right' }], text: [{ type: 'counter', from: 0, to: 1000000, prefix: '', suffix: ' views', at: 0.2, x: 0.62, y: 0.4, size: 0.6 }] },
      { id: 'c', start: 7, end: 10, set: 'street', light: 'night', camera: { shot: 'face', on: 'pal', move: 'push' }, actors: [{ id: 'pal', x: 0.5, pose: 'stand', mood: 'shocked', face: 'front' }], fx: ['zoomlines'] },
    ],
  };
  const film = compileFilm(story, { aspect: '16:9', look: 'ember', duration: 10 });
  const g = canvas.getContext('2d');
  const t0 = performance.now();
  const loop = () => {
    if (!canvas.isConnected) return;
    renderFrame(g, film, ((performance.now() - t0) / 1000) % 10, { env: browserEnv, endFade: false });
    heroRaf = requestAnimationFrame(loop);
  };
  loop();
}

// ------------------------------------------------------------ project shell
const TABS = [['script', 'Script'], ['voice', 'Voice'], ['storyboard', 'Storyboard'], ['preview', 'Preview & Export']];

function tabDone(p, t) {
  if (t === 'script') return !!p.script;
  if (t === 'voice') return !!p.words?.length;
  if (t === 'storyboard') return !!p.storyboard?.shots?.length;
  if (t === 'preview') return !!p.renders?.some((r) => !r.preview);
  return false;
}

function renderProject() {
  const p = state.project;
  state.player?.destroy();
  state.player = null;
  $('#main').innerHTML = `
  <div class="page">
    <div class="proj-head">
      <input class="title-input" id="titleInput" value="${esc(p.title)}" aria-label="Video title">
      <button class="btn small ghost" data-action="open-folder" title="Open the project folder">📁 Folder</button>
      <button class="btn small ghost danger" data-action="delete-project">Delete</button>
    </div>
    <div class="tabs">${TABS.map(([k, l], i) => `<button class="tab ${state.tab === k ? 'on' : ''} ${tabDone(p, k) ? 'done' : ''}" data-tab="${k}"><span class="num">${tabDone(p, k) && state.tab !== k ? '✓' : i + 1}</span>${l}</button>`).join('')}</div>
    <div id="tabBody"></div>
  </div>`;
  $('#titleInput').onchange = async (e) => { await patchProject({ title: e.target.value.trim() || 'Untitled video' }); refreshProjects(); };
  ({ script: renderScriptTab, voice: renderVoiceTab, storyboard: renderStoryboardTab, preview: renderPreviewTab })[state.tab]();
}

function goTab(t) { state.tab = t; renderProject(); }

// ------------------------------------------------------------ 1. script
function renderScriptTab() {
  const p = state.project;
  const w = p.writer || {};
  const o = w.options || {};
  const bd = w.breakdown;
  $('#tabBody').innerHTML = `
  <div class="card">
    <h3>Writer's room</h3>
    <div class="sub">Already have a script or voiceover? Skip to <a href="#" data-tab="voice">Voice</a>. Otherwise, an AI can brainstorm ideas, build the story, and write the narration.</div>
    <div class="grid3">
      <label class="field">Niche<select id="wNiche">${['What if', 'History', 'Science', 'Psychology', 'Money & business', 'Documentary', 'Geography', 'Mystery', 'Self improvement', 'Custom…'].map((n) => `<option ${o.niche === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field">Format<select id="wFormat"><option value="long" ${o.format !== 'short' ? 'selected' : ''}>Long-form (YouTube)</option><option value="short" ${o.format === 'short' ? 'selected' : ''}>Short (Shorts / TikTok / Reels)</option></select></label>
      <label class="field">Length (minutes, long-form)<input type="number" id="wMinutes" min="1" max="15" step="0.5" value="${o.minutes || 3}"></label>
    </div>
    <div class="grid2" style="margin-top:10px">
      <label class="field">Channel focus <span class="dim">(optional)</span><input type="text" id="wFocus" value="${esc(o.focus || '')}" placeholder="e.g. human body superpowers, everyday science"></label>
      <label class="field">Topic <span class="dim">(optional: leave empty for ideas)</span><input type="text" id="wTopic" value="${esc(o.topic || '')}" placeholder="e.g. What if you never needed sleep?"></label>
      <label class="field">Already published titles <span class="dim">(avoid repeats)</span><input type="text" id="wAvoid" value="${esc(o.avoid || '')}"></label>
      <label class="field">Series <span class="dim">(optional: name of the series)</span><input type="text" id="wSeries" value="${esc(o.series || '')}"></label>
    </div>
    <label class="field" style="margin-top:10px">Reference titles or style notes <span class="dim">(optional)</span><input type="text" id="wRef" value="${esc(o.reference || '')}"></label>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="wIdeas">${w.ideas?.length ? 'New ideas' : 'Get 10 ideas'}</button>${w.ideas?.length ? '<button class="btn" id="wMore">More ideas</button>' : ''}<span class="grow"></span></div>
    ${progressBox('wJob')}
  </div>
  ${w.ideas?.length ? `<div class="card"><h3>Pick an idea</h3><div class="sub">Click one, then build its story.</div>
    <div class="ideas">${w.ideas.map((i, k) => `<button class="idea ${w.idea?.title === i.title ? 'on' : ''}" data-idea="${k}"><b>${esc(i.title)}</b><div class="hook">“${esc(i.hook || '')}”</div><div class="prem">${esc(i.premise || '')}</div></button>`).join('')}</div>
    <div class="row" style="margin-top:12px"><input type="text" id="wBdNotes" placeholder="Notes for the story (optional)" class="grow"><button class="btn primary" id="wBreakdown" ${w.idea ? '' : 'disabled'}>Build the story</button></div></div>` : ''}
  ${bd ? `<div class="card"><div class="row between"><h3>Story breakdown: ${esc(bd.title || '')}</h3><button class="btn small ghost" id="wEditBd">Edit as text</button></div>
    <div id="bdView">${breakdownHtml(bd)}</div>
    <textarea class="code" id="bdText" rows="16" hidden>${esc(JSON.stringify(bd, null, 2))}</textarea>
    <div class="row" style="margin-top:12px"><input type="text" id="wScriptNotes" class="grow" placeholder="Notes for the script (optional), e.g. more suspense, mention Japan"><button class="btn primary" id="wScript">${p.script ? 'Rewrite the script' : 'Approve & write the script'}</button></div></div>` : ''}
  <div class="card">
    <div class="row between"><h3>Narration script</h3><span class="small muted" id="wCount"></span></div>
    <div class="sub">This is what your voiceover should say. Edit freely, or paste your own.</div>
    <textarea id="scriptText" rows="12" placeholder="Paste or write your narration here…">${esc(p.script || '')}</textarea>
    <div class="row" style="margin-top:10px">
      <button class="btn" id="wCopy">Copy script</button><button class="btn" id="wDownload">Download .txt</button>
      ${bd ? '<input type="text" id="wReviseNotes" class="grow" placeholder="Ask for a revision, e.g. make it 30 seconds longer"><button class="btn" id="wRevise">Revise</button>' : '<span class="grow"></span>'}
      <button class="btn gold" data-tab="voice">Next: add the voiceover →</button>
    </div>
    <p class="dim small" style="margin-top:10px">Make the voiceover with any text-to-speech tool you like, or record it yourself, then upload it on the Voice step.</p>
  </div>`;
  const opts = () => ({ niche: $('#wNiche').value === 'Custom…' ? prompt('Your niche?') || 'What if' : $('#wNiche').value, format: $('#wFormat').value, minutes: Number($('#wMinutes').value) || 3, focus: $('#wFocus').value.trim(), topic: $('#wTopic').value.trim(), avoid: $('#wAvoid').value.trim(), series: $('#wSeries').value.trim(), reference: $('#wRef').value.trim() });
  const count = () => { const n = ($('#scriptText').value.match(/\S+/g) || []).length; $('#wCount').textContent = `${n} words · about ${fmtTime((n / 150) * 60)} spoken`; };
  count();
  $('#scriptText').oninput = count;
  $('#scriptText').onchange = () => patchProject({ script: $('#scriptText').value });
  const writer = async (step, body, btn) => {
    btn.disabled = true;
    try {
      await runJob(() => api(`/projects/${p.id}/writer/${step}`, { method: 'POST', body }), { progressEl: $('#wJob'), retry: (manualReply) => api(`/projects/${p.id}/writer/${step}`, { method: 'POST', body: { ...body, manualReply } }) });
      await reloadProject();
      renderProject();
    } catch (e) { if (e.message !== 'Cancelled') toast(e.message, 'err'); btn.disabled = false; }
  };
  $('#wIdeas').onclick = (e) => writer('ideas', { options: opts() }, e.target);
  $('#wMore') && ($('#wMore').onclick = (e) => writer('ideas', { options: opts(), more: true }, e.target));
  $$('[data-idea]').forEach((b) => (b.onclick = async () => { const idea = w.ideas[+b.dataset.idea]; await patchProject({ writer: { ...w, idea } }); renderProject(); }));
  $('#wBreakdown') && ($('#wBreakdown').onclick = (e) => writer('breakdown', { options: opts(), idea: w.idea, notes: $('#wBdNotes').value.trim() }, e.target));
  $('#wEditBd') && ($('#wEditBd').onclick = () => { $('#bdView').hidden = !$('#bdView').hidden; $('#bdText').hidden = !$('#bdText').hidden; });
  const currentBd = () => { if ($('#bdText') && !$('#bdText').hidden) { try { return JSON.parse($('#bdText').value); } catch { toast('The breakdown text is not valid JSON', 'err'); throw new Error('bad'); } } return bd; };
  $('#wScript') && ($('#wScript').onclick = (e) => writer('script', { options: opts(), breakdown: currentBd(), notes: $('#wScriptNotes').value.trim() }, e.target));
  $('#wRevise') && ($('#wRevise').onclick = async (e) => { await patchProject({ script: $('#scriptText').value }); writer('script', { options: opts(), breakdown: currentBd(), notes: $('#wReviseNotes').value.trim(), revise: true }, e.target); });
  $('#wCopy').onclick = async () => { await navigator.clipboard.writeText($('#scriptText').value); toast('Script copied', 'ok'); };
  $('#wDownload').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([$('#scriptText').value], { type: 'text/plain' })); a.download = `${p.title}.txt`; a.click(); };
}

function breakdownHtml(bd) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  return `
    ${bd.question ? `<p><b>Central question:</b> ${esc(bd.question)}</p>` : ''}
    ${bd.hook ? `<p><b>Hook:</b> <i>${esc(bd.hook)}</i></p>` : ''}
    ${bd.tone ? `<p class="muted small">Tone: ${esc(bd.tone)}</p>` : ''}
    ${arr(bd.characters).length ? `<p><b>Characters:</b> ${arr(bd.characters).map((c) => `${esc(c.name)} <span class="dim">(${esc(c.role || '')}${c.look ? ', ' + esc(c.look) : ''})</span>`).join(' · ')}</p>` : ''}
    ${arr(bd.rules).length ? `<p><b>Rules of the scenario</b></p><ul class="small">${arr(bd.rules).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${arr(bd.facts).length ? `<p><b>Fact bank</b></p><div class="stack" style="gap:4px">${arr(bd.facts).map((f) => `<div class="fact"><span class="tag ${f.real === false ? 'fiction' : 'real'}">${f.real === false ? 'fiction' : 'real'}</span>${esc(f.fact)}</div>`).join('')}</div>` : ''}
    ${arr(bd.sections).map((s) => `<div class="bd-section"><b>${esc(s.name)}</b><div class="small">${esc(s.beats || '')}</div></div>`).join('')}
    ${bd.ending ? `<p><b>Ending:</b> ${esc(bd.ending)}</p>` : ''}`;
}

// ------------------------------------------------------------ 2. voice
function renderVoiceTab() {
  const p = state.project;
  const looks = state.status.looks;
  const timingNote = { whisper: 'Timed from your voiceover with local speech recognition.', subtitles: 'Timed from your subtitle file.', estimated: 'Estimated timing from the script (no audio). Upload the real voiceover later and transcribe again.' }[p.timing] || '';
  $('#tabBody').innerHTML = `
  <div class="two-col">
    <div>
      <div class="card">
        <h3>Voiceover</h3>
        <div class="sub">Any audio file: MP3, WAV, M4A… Make it with your favourite text-to-speech tool, or record yourself.</div>
        <div class="drop" id="drop"><div class="big">${p.voice ? '🎙 ' + esc(p.voice.name) : 'Drop your voiceover here'}</div><div class="muted small">${p.voice ? `${fmtTime(p.voice.duration)} · click or drop to replace` : 'or click to choose a file'}</div></div>
        <input type="file" id="voiceFile" accept="audio/*,video/mp4,.m4a,.flac,.opus" hidden>
        ${p.voice ? `<audio controls src="${fileUrl(p, p.voice.file)}" id="voiceAudio" style="margin-top:12px"></audio>` : ''}
        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="vTranscribe" ${p.voice ? '' : 'disabled'}>${p.words?.length && p.timing === 'whisper' ? 'Transcribe again' : 'Transcribe & time the words'}</button>
          <button class="btn ghost small" id="vSubs">Use subtitles (SRT/VTT) instead</button>
          <input type="file" id="subsFile" accept=".srt,.vtt,.txt" hidden>
        </div>
        ${progressBox('vJob')}
        <details style="margin-top:12px"><summary class="muted small" style="cursor:pointer">No voiceover yet?</summary>
          <div class="row" style="margin-top:10px">
            <button class="btn small" id="vEstimate" ${p.script ? '' : 'disabled'}>Time my script without audio</button>
            <button class="btn small" id="vDraft" ${p.script ? '' : 'disabled'}>Make a draft voice with this computer's voice</button>
          </div>
          <p class="dim small" style="margin-top:6px">${p.script ? 'Good for trying out the storyboard. Swap in the real voiceover later.' : 'Write or paste a script on the Script step first.'}</p>
        </details>
      </div>
      <div class="card">
        <div class="row between"><h3>Transcript</h3><span class="small muted">${p.words?.length ? `${p.words.length} words · ${fmtTime(p.duration)}` : ''}</span></div>
        ${p.words?.length ? `<div class="sub">${esc(timingNote)} Click a word to hear it.</div><div class="words" id="words">${p.words.map((w, i) => `<span class="word" data-w="${i}">${esc(w.text)}<i>${w.start.toFixed(1)}</i></span>`).join('')}</div>` : '<div class="empty small">The timed transcript appears here.</div>'}
      </div>
    </div>
    <div>
      <div class="card">
        <h3>Video settings</h3>
        <div class="stack">
          <div><div class="small muted" style="font-weight:600;margin-bottom:5px">Aspect</div><div class="seg" id="sAspect"><button data-v="16:9" class="${p.aspect === '16:9' ? 'on' : ''}">16:9 YouTube</button><button data-v="9:16" class="${p.aspect === '9:16' ? 'on' : ''}">9:16 Shorts</button></div></div>
          <div class="grid2">
            <label class="field">Resolution<select id="sRes">${[['720p', '720p (fast)'], ['1080p', '1080p (recommended)'], ['1440p', '1440p'], ['2160p', '4K (slow)']].map(([v, l]) => `<option value="${v}" ${p.resolution === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field">Frame rate<select id="sFps">${[24, 30, 60].map((v) => `<option ${+p.fps === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          </div>
          <label class="check"><input type="checkbox" id="sCaptions" ${p.captions ? 'checked' : ''}> Burn in word-by-word captions</label>
          <label class="field">Music<select id="sMusic"><option value="auto" ${p.music?.mode === 'auto' ? 'selected' : ''}>Generated to match the story</option><option value="file" ${p.music?.mode === 'file' ? 'selected' : ''}>My own music file${p.music?.name ? ': ' + esc(p.music.name) : ''}</option><option value="none" ${p.music?.mode === 'none' ? 'selected' : ''}>No music</option></select></label>
          <input type="file" id="musicFile" accept="audio/*" hidden>
          <label class="field">Music volume<input type="range" id="sMusicVol" min="0" max="1" step="0.05" value="${p.music?.volume ?? 0.5}"></label>
          <label class="check"><input type="checkbox" id="sSfx" ${p.sfx !== false ? 'checked' : ''}> Sound effects</label>
          <div><div class="small muted" style="font-weight:600;margin-bottom:5px">Look <span class="dim">(change any time)</span></div>
            <div class="stack" style="gap:6px">${looks.map((l) => `<button class="look-btn" data-look="${l.id}" style="text-align:left;display:flex;gap:10px;align-items:center" ${p.look === l.id ? 'aria-pressed="true"' : ''}><span class="swatch" style="width:60px;margin:0">${l.swatch.map((c) => `<span style="background:${c}"></span>`).join('')}</span><span><b>${esc(l.name)}</b><br><span class="dim" style="font-weight:400">${esc(l.blurb)}</span></span></button>`).join('')}</div>
          </div>
          <label class="field">Notes for the director <span class="dim">(optional)</span><textarea id="sBrief" rows="3" placeholder="e.g. the hero is a teenage girl with a ponytail; keep it funny; lots of numbers on screen">${esc(p.brief || '')}</textarea></label>
          <button class="btn gold block" id="vNext" ${p.words?.length ? '' : 'disabled'}>Next: direct the storyboard →</button>
        </div>
      </div>
    </div>
  </div>`;
  $$('.look-btn').forEach((b) => b.classList.toggle('on', b.dataset.look === p.look));
  const upload = async (file, kind) => {
    const box = $('#vJob');
    box.hidden = false;
    $('.job-msg', box).textContent = `Uploading ${file.name}…`;
    await api(`/projects/${p.id}/upload?kind=${kind}&name=${encodeURIComponent(file.name)}`, { method: 'PUT', raw: file });
    await reloadProject();
  };
  const drop = $('#drop');
  drop.onclick = () => $('#voiceFile').click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = async (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) { try { await upload(f, 'voice'); doTranscribe(); } catch (err) { toast(err.message, 'err'); } } };
  $('#voiceFile').onchange = async (e) => { const f = e.target.files[0]; if (f) { try { await upload(f, 'voice'); doTranscribe(); } catch (err) { toast(err.message, 'err'); renderProject(); } } };
  const doTranscribe = async () => {
    renderProject();
    $('#vTranscribe').disabled = true;
    try {
      const r = await runJob(() => api(`/projects/${p.id}/transcribe`, { method: 'POST', body: {} }), { progressEl: $('#vJob') });
      toast(`Transcribed ${r.words} words`, 'ok');
      await reloadProject();
      renderProject();
    } catch (e) { toast(e.message, 'err'); $('#vTranscribe').disabled = false; }
  };
  $('#vTranscribe').onclick = doTranscribe;
  $('#vSubs').onclick = () => $('#subsFile').click();
  $('#subsFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { await api(`/projects/${p.id}/upload?kind=subs&name=${encodeURIComponent(f.name)}`, { method: 'PUT', raw: f }); await reloadProject(); renderProject(); toast('Timing loaded from subtitles', 'ok'); } catch (err) { toast(err.message, 'err'); } };
  $('#vEstimate').onclick = async () => { try { await api(`/projects/${p.id}/estimate`, { method: 'POST', body: {} }); await reloadProject(); renderProject(); toast('Script timed (estimate)', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  $('#vDraft').onclick = async (e) => {
    e.target.disabled = true;
    try { await runJob(() => api(`/projects/${p.id}/draft-voice`, { method: 'POST' }), { progressEl: $('#vJob') }); await reloadProject(); renderProject(); toast('Draft voice ready', 'ok'); } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
  };
  $$('.word').forEach((el) => (el.onclick = () => { const a = $('#voiceAudio'); if (a) { a.currentTime = p.words[+el.dataset.w].start; a.play(); } }));
  $$('#sAspect button').forEach((b) => (b.onclick = async () => { await patchProject({ aspect: b.dataset.v, captions: b.dataset.v === '9:16' ? true : p.captions }); renderProject(); }));
  $('#sRes').onchange = (e) => patchProject({ resolution: e.target.value });
  $('#sFps').onchange = (e) => patchProject({ fps: +e.target.value });
  $('#sCaptions').onchange = (e) => patchProject({ captions: e.target.checked });
  $('#sSfx').onchange = (e) => patchProject({ sfx: e.target.checked });
  $('#sMusicVol').onchange = (e) => patchProject({ music: { ...p.music, volume: +e.target.value } });
  $('#sMusic').onchange = async (e) => {
    if (e.target.value === 'file') { $('#musicFile').click(); return; }
    await patchProject({ music: { ...p.music, mode: e.target.value } });
  };
  $('#musicFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return renderProject(); try { await upload(f, 'music'); renderProject(); toast('Music added', 'ok'); } catch (err) { toast(err.message, 'err'); } };
  $$('.look-btn').forEach((b) => (b.onclick = async () => { await patchProject({ look: b.dataset.look }); $$('.look-btn').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#sBrief').onchange = (e) => patchProject({ brief: e.target.value });
  $('#vNext').onclick = () => { state.autoDirect = !p.storyboard; goTab('storyboard'); };
}

// ------------------------------------------------------------ 3. storyboard
function filmFor(p, look) {
  return compileFilm(p.storyboard, { aspect: p.aspect, words: p.words || [], look: look || p.look, captions: p.captions, duration: p.duration });
}

function renderStoryboardTab() {
  const p = state.project;
  const sb = p.storyboard;
  const vertical = p.aspect === '9:16';
  if (!p.words?.length) {
    $('#tabBody').innerHTML = '<div class="card empty"><div class="big">Add a voiceover first</div>The storyboard is timed to your narration. <a href="#" data-tab="voice">Go to Voice</a></div>';
    return;
  }
  const mode = state.status.settings.claudeMode;
  // Parts saved from an earlier visit: the button carries on from them.
  const planned = mode === 'manual' ? p.parts?.parts : null;
  const nextPart = planned?.some((x) => x.status !== 'todo') ? planned.find((x) => x.status !== 'ok') : null;
  $('#tabBody').innerHTML = `
  <div class="card">
    <div class="sb-toolbar">
      <button class="btn primary" id="sbDirect">${nextPart ? `▶ Continue with part ${nextPart.n} of ${planned.length}` : sb ? '↻ Direct again' : '🎬 Direct the video'}</button>
      ${nextPart ? '<button class="btn ghost" id="sbRestart">Start over</button>' : ''}
      <span class="small muted">${mode === 'mcp' ? 'Claude app (MCP)' : 'Copy & paste mode'} · <a href="#" data-action="open-settings">change</a></span>
      <span class="grow"></span>
      ${sb ? `<div class="cast-row">${(sb.cast || []).map((c) => `<span class="cast-chip"><i style="background:${esc(c.color || '#888')}"></i>${esc(c.name || c.id)}</span>`).join('')}</div>` : ''}
    </div>
    ${progressBox('sbJob')}
    ${p.warnings?.length ? `<details class="warn-box" style="margin-top:10px"><summary>${p.warnings.length} automatic fix${p.warnings.length > 1 ? 'es' : ''} applied</summary><ul class="small">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
  </div>
  ${sb ? `<div class="two-col" style="margin-top:14px">
    <div class="shots ${vertical ? 'vertical' : ''}" id="shots">${sb.shots.map((s) => `<button class="shot ${state.shot === s.id ? 'on' : ''}" data-shot="${esc(s.id)}"><canvas width="${vertical ? 180 : 320}" height="${vertical ? 320 : 180}"></canvas><div class="meta"><div class="top"><span>${esc(s.id)} · ${esc(s.set)}</span><span>${fmtTime(s.start)}–${fmtTime(s.end)}</span></div><div class="line">${esc(s.line || s.scene || '')}</div></div></button>`).join('')}</div>
    <div class="drawer" id="drawer"></div>
  </div>
  <div class="row end" style="margin-top:14px"><button class="btn gold" data-tab="preview">Next: preview &amp; export →</button></div>` : `<div class="card empty" style="margin-top:14px"><div class="big">Ready to direct</div>The AI will plan every shot: locations, characters, acting, camera moves, on-screen numbers, effects and sound. ${p.duration > 75 && mode !== 'manual' ? 'Longer videos are directed in several passes.' : ''}</div>`}`;

  const direct = async (first = {}) => {
    $('#sbDirect').disabled = true;
    const post = (body) => api(`/projects/${p.id}/storyboard`, { method: 'POST', body });
    try {
      const r = await runJob(() => post(first), { progressEl: $('#sbJob'), retry: (answer, info) => post(typeof answer === 'string' ? { manualReply: answer, part: info.part } : answer) });
      toast(`Storyboard ready: ${r.shots} shots${r.parts ? `, merged from ${r.parts} parts` : ''}`, 'ok');
      await reloadProject();
      renderProject();
    } catch (e) {
      if (e.message !== 'Cancelled') toast(e.message, 'err');
      // saved parts may have changed, so the button needs to show where things stand
      await reloadProject();
      renderProject();
    }
  };
  $('#sbDirect').onclick = () => { if (nextPart || !sb || confirm('Replace the current storyboard with a new one?')) direct(); };
  if ($('#sbRestart')) $('#sbRestart').onclick = () => { if (confirm('Throw away the saved parts and start again from part 1?')) direct({ restart: true }); };
  if (state.autoDirect && !sb) { state.autoDirect = false; direct(); return; }
  if (!sb) return;
  drawThumbs();
  $$('.shot').forEach((b) => (b.onclick = () => { state.shot = b.dataset.shot; $$('.shot').forEach((x) => x.classList.toggle('on', x === b)); renderDrawer(); }));
  renderDrawer();
}

async function drawThumbs() {
  const p = state.project;
  await fontsReady();
  const film = filmFor(p);
  const cards = $$('#shots .shot');
  for (let i = 0; i < cards.length; i++) {
    const s = film.shots.find((x) => x.id === cards[i].dataset.shot);
    if (!s) continue;
    const c = $('canvas', cards[i]);
    if (!c.isConnected) return;
    renderFrame(c.getContext('2d'), film, s.start + (s.end - s.start) * 0.7, { env: browserEnv, endFade: false, captions: false });
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
}

function renderDrawer() {
  const p = state.project;
  const el = $('#drawer');
  if (!el) return;
  const shot = p.storyboard.shots.find((s) => s.id === state.shot);
  if (!shot) {
    el.innerHTML = `<div class="card"><h3>Shot details</h3><div class="sub">Click a shot to see what was planned, change it in plain English, or edit its JSON.</div><p class="small muted">${p.storyboard.shots.length} shots · ${fmtTime(p.duration)} · ${(p.storyboard.shots.length / (p.duration / 60)).toFixed(0)} shots per minute</p></div>`;
    return;
  }
  el.innerHTML = `<div class="card">
    <div class="row between"><h3>${esc(shot.id)} · ${fmtTime(shot.start)}–${fmtTime(shot.end)}</h3><button class="btn small ghost" id="dPlay">▶ Play</button></div>
    ${shot.line ? `<p><i>“${esc(shot.line)}”</i></p>` : ''}
    ${shot.scene ? `<p class="small muted">${esc(shot.scene)}</p>` : ''}
    <label class="field">Describe the change to this shot<textarea id="dInstr" rows="3" placeholder="e.g. make it a close-up of her shocked face, add rain, show the number 7 big"></textarea></label>
    <div class="row" style="margin-top:8px"><button class="btn primary" id="dRevise">Change shot</button></div>
    ${progressBox('dJob')}
    <details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Edit JSON</summary>
      <textarea class="code" id="dJson" rows="16" style="margin-top:8px">${esc(JSON.stringify(shot, null, 2))}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn small" id="dApply">Apply JSON</button></div>
    </details>
  </div>`;
  $('#dPlay').onclick = () => { state.playFrom = shot.start; goTab('preview'); };
  $('#dRevise').onclick = async (e) => {
    const instruction = $('#dInstr').value.trim();
    if (!instruction) return toast('Describe the change first', 'err');
    e.target.disabled = true;
    try {
      await runJob(() => api(`/projects/${p.id}/revise`, { method: 'POST', body: { shotId: shot.id, instruction } }), { progressEl: $('#dJob'), retry: (manualReply) => api(`/projects/${p.id}/revise`, { method: 'POST', body: { shotId: shot.id, instruction, manualReply } }) });
      await reloadProject();
      api(`/projects/${p.id}/mix`, { method: 'POST' }).catch(() => {});
      renderProject();
      toast('Shot updated', 'ok');
    } catch (err) { if (err.message !== 'Cancelled') toast(err.message, 'err'); e.target.disabled = false; }
  };
  $('#dApply').onclick = async () => {
    let next;
    try { next = JSON.parse($('#dJson').value); } catch { return toast('That JSON is not valid', 'err'); }
    const shots = p.storyboard.shots.map((s) => (s.id === shot.id ? { ...next, id: shot.id } : s));
    await patchProject({ storyboard: { ...p.storyboard, shots } });
    renderProject();
    toast('Shot updated', 'ok');
  };
}

let fontsPromise = null;
function fontsReady() {
  fontsPromise ||= Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('40px "Anton"'), document.fonts.load('700 40px "Rubik"'), document.fonts.load('800 40px "Rubik"')]).catch(() => {});
  return fontsPromise;
}

// ------------------------------------------------------------ 4. preview & export
class Player {
  constructor(root, p) {
    this.p = p;
    this.root = root;
    this.film = filmFor(p);
    this.canvas = $('canvas', root);
    this.g = this.canvas.getContext('2d');
    this.t = state.playFrom || 0;
    state.playFrom = 0;
    this.playing = false;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    const src = p.previewMix ? fileUrl(p, p.previewMix.file, `&m=${p.previewMix.at}`) : p.voice ? fileUrl(p, p.voice.file) : '';
    if (src) this.audio.src = src;
    this.hasAudio = !!src;
    const { width, height } = p.aspect === '9:16' ? { width: 540, height: 960 } : { width: 1280, height: 720 };
    this.canvas.width = width;
    this.canvas.height = height;
    this.bar = $('.timebar', root);
    this.bar.innerHTML = `<div class="track"></div>${this.film.shots.map((s) => `<div class="mark" style="left:${(s.start / this.film.duration) * 100}%"></div>`).join('')}<div class="fill"></div><div class="knob"></div>`;
    this.bar.onpointerdown = (e) => {
      const seek = (ev) => { const r = this.bar.getBoundingClientRect(); this.seek(((ev.clientX - r.left) / r.width) * this.film.duration); };
      seek(e);
      this.bar.setPointerCapture(e.pointerId);
      this.bar.onpointermove = seek;
      this.bar.onpointerup = () => { this.bar.onpointermove = null; };
    };
    $('.play', root).onclick = () => this.toggle();
    this.onKey = (e) => { if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); this.toggle(); } };
    document.addEventListener('keydown', this.onKey);
    this.loop = this.loop.bind(this);
    fontsReady().then(() => this.draw());
    this.raf = requestAnimationFrame(this.loop);
  }
  setLook(look) { this.p = { ...this.p, look }; this.film = filmFor(this.p, look); this.draw(); }
  seek(t) { this.t = Math.max(0, Math.min(this.film.duration, t)); if (this.hasAudio) this.audio.currentTime = this.t; this.draw(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  play() {
    if (this.t >= this.film.duration - 0.05) this.seek(0);
    this.playing = true;
    this.clock = performance.now() - this.t * 1000;
    if (this.hasAudio) { this.audio.currentTime = this.t; this.audio.play().catch(() => {}); }
    $('.play', this.root).textContent = '❚❚';
  }
  pause() { this.playing = false; this.audio.pause(); $('.play', this.root).textContent = '▶'; }
  loop() {
    if (!this.canvas.isConnected) return this.destroy();
    if (this.playing) {
      const useAudio = this.hasAudio && !this.audio.paused && this.audio.currentTime < (this.audio.duration || Infinity) - 0.02;
      this.t = useAudio ? this.audio.currentTime : (performance.now() - this.clock) / 1000;
      if (this.t >= this.film.duration) { this.t = this.film.duration; this.pause(); }
      this.draw();
    }
    this.raf = requestAnimationFrame(this.loop);
  }
  draw() {
    renderFrame(this.g, this.film, this.t, { env: browserEnv });
    const k = this.t / this.film.duration;
    $('.fill', this.bar).style.width = `${k * 100}%`;
    $('.knob', this.bar).style.left = `${k * 100}%`;
    $('.time', this.root).textContent = `${fmtTime(this.t)} / ${fmtTime(this.film.duration)}`;
  }
  destroy() { cancelAnimationFrame(this.raf); this.audio.pause(); this.audio.src = ''; document.removeEventListener('keydown', this.onKey); }
}

function renderPreviewTab() {
  const p = state.project;
  if (!p.storyboard?.shots?.length) {
    $('#tabBody').innerHTML = '<div class="card empty"><div class="big">No storyboard yet</div><a href="#" data-tab="storyboard">Direct the storyboard</a> first.</div>';
    return;
  }
  const looks = state.status.looks;
  const finals = (p.renders || []);
  $('#tabBody').innerHTML = `
  <div class="two-col">
    <div>
      <div class="player" id="player">
        <div class="stage-wrap"><canvas></canvas></div>
        <div class="controls"><button class="play" aria-label="Play">▶</button><div class="timebar"></div><span class="time"></span></div>
      </div>
      <div class="card" style="margin-top:14px">
        <div class="row between"><h3>Look</h3><span class="small muted">Instant: the preview updates as you pick.</span></div>
        <div class="look-grid">${looks.map((l) => `<button class="look-btn ${p.look === l.id ? 'on' : ''}" data-look="${l.id}"><canvas width="${p.aspect === '9:16' ? 108 : 192}" height="${p.aspect === '9:16' ? 192 : 108}"></canvas>${esc(l.name)}</button>`).join('')}</div>
      </div>
    </div>
    <div>
      <div class="card">
        <h3>Export</h3>
        <div class="sub">${esc(p.aspect)} · ${esc(p.resolution)} (${p.outputSize.width}×${p.outputSize.height}) · ${p.fps} fps · ${p.captions ? 'captions' : 'no captions'} · ${p.music?.mode === 'none' ? 'no music' : 'music'} · ${p.sfx !== false ? 'SFX' : 'no SFX'}</div>
        <div class="stack">
          <button class="btn" id="eSound">↻ Refresh preview sound</button>
          <button class="btn" id="eStill">📷 Save this frame (PNG)</button>
          <button class="btn" id="ePreview">Render a 20 s preview clip (half size)</button>
          <button class="btn primary" id="eFinal">Render final video</button>
          <button class="btn ghost small" id="eCancel" hidden>Cancel render</button>
          ${progressBox('eJob')}
          <p class="dim small">Change resolution, captions, music and sound on the <a href="#" data-tab="voice">Voice</a> step.</p>
        </div>
      </div>
      <div class="card">
        <h3>Your renders</h3>
        ${finals.length ? `<div class="renders">${finals.map((r) => `<div class="render-item"><video src="${fileUrl(p, r.file)}" controls preload="metadata"></video><div><b>${r.preview ? 'Preview clip' : 'Final video'}</b><div class="small muted">${r.width}×${r.height} · ${fmtTime(r.duration)} · rendered in ${Math.round(r.seconds)}s</div><div class="row" style="margin-top:6px"><a class="btn small" href="${fileUrl(p, r.file, '&download=1')}">Download</a><button class="btn small ghost" data-action="open-folder">Show in folder</button></div></div></div>`).join('')}</div>` : '<div class="empty small">Rendered videos appear here.</div>'}
      </div>
    </div>
  </div>`;
  state.player = new Player($('#player'), p);
  fontsReady().then(() => {
    const t = state.player.t || Math.min(p.duration * 0.3, 6);
    for (const b of $$('.look-btn')) {
      const film = filmFor(p, b.dataset.look);
      renderFrame($('canvas', b).getContext('2d'), film, t, { env: browserEnv, endFade: false });
    }
  });
  $$('.look-btn').forEach((b) => (b.onclick = async () => {
    $$('.look-btn').forEach((x) => x.classList.toggle('on', x === b));
    state.player.setLook(b.dataset.look);
    await patchProject({ look: b.dataset.look });
  }));
  $('#eSound').onclick = async (e) => {
    e.target.disabled = true;
    try { state.player.pause(); await runJob(() => api(`/projects/${p.id}/mix`, { method: 'POST' }), { progressEl: $('#eJob') }); await reloadProject(); renderProject(); toast('Preview sound updated', 'ok'); } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
  };
  const render = async (preview, btn) => {
    state.player.pause();
    $$('#eSound, #ePreview, #eFinal').forEach((b) => (b.disabled = true));
    $('#eCancel').hidden = false;
    let jobId = null;
    $('#eCancel').onclick = () => jobId && api(`/jobs/${jobId}/cancel`, { method: 'POST' });
    try {
      const from = preview ? Math.max(0, Math.min(state.player.t, p.duration - 20)) : 0;
      const r = await runJob(async () => { const j = await api(`/projects/${p.id}/render`, { method: 'POST', body: { preview, from } }); jobId = j.id; return j; }, { progressEl: $('#eJob') });
      toast(`${preview ? 'Preview' : 'Video'} rendered in ${Math.round(r.seconds)}s`, 'ok');
      await reloadProject();
      renderProject();
    } catch (e) { toast(e.message, 'err'); $$('#eSound, #ePreview, #eFinal').forEach((b) => (b.disabled = false)); $('#eCancel').hidden = true; }
  };
  // A full-size PNG of the moment the preview is paused on: the starting point for a thumbnail.
  $('#eStill').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await api(`/projects/${p.id}/still`, { method: 'POST', body: { t: state.player?.t || 0 } });
      const a = document.createElement('a');
      a.href = fileUrl(p, r.file, `&download=1&t=${Date.now()}`);
      a.download = `${p.title}-frame.png`;
      a.click();
      toast('Frame saved', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    e.target.disabled = false;
  };
  $('#ePreview').onclick = (e) => render(true, e.target);
  $('#eFinal').onclick = (e) => render(false, e.target);
}

// ------------------------------------------------------------ global actions
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-action], [data-open], [data-tab], [data-go]');
  if (!t) return;
  if (t.dataset.open) { e.preventDefault(); return openProject(t.dataset.open); }
  if (t.dataset.tab && state.project) { e.preventDefault(); return goTab(t.dataset.tab); }
  if (t.dataset.go === 'home') { e.preventDefault(); return renderHome(); }
  const a = t.dataset.action;
  if (!a) return;
  e.preventDefault();
  try {
    if (a === 'close-modal') closeModal();
    if (a === 'open-settings') settingsModal();
    if (a === 'new-project') {
      const title = await askText('What is this video called?', 'You can change it later.', 'Untitled video');
      if (title === null) return;
      const p = await api('/projects', { method: 'POST', body: { title: title.trim() || 'Untitled video' } });
      await openProject(p.id, 'script');
    }
    if (a === 'demo') { const p = await api('/projects/demo', { method: 'POST' }); await openProject(p.id, 'preview'); toast('Demo opened: the timing is estimated (no voiceover). Press play!'); }
    if (a === 'open-folder' && state.project) await api(`/projects/${state.project.id}/open-folder`, { method: 'POST' });
    if (a === 'delete-project' && state.project) {
      if (!confirm(`Delete "${state.project.title}" and all its files? This cannot be undone.`)) return;
      await api(`/projects/${state.project.id}`, { method: 'DELETE' });
      toast('Deleted');
      renderHome();
    }
  } catch (err) { toast(err.message, 'err'); }
});
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

// ------------------------------------------------------------ boot
(async function boot() {
  try {
    state.status = await api('/status');
  } catch (e) {
    $('#main').innerHTML = `<div class="page"><div class="card empty"><div class="big">Can't reach Stickframe</div>${esc(e.message)}</div></div>`;
    return;
  }
  await refreshProjects();
  const route = () => {
    const m = /^#\/p\/([a-z0-9-]+)/.exec(location.hash);
    if (m && state.projects.some((p) => p.id === m[1])) { if (state.project?.id !== m[1]) openProject(m[1]); }
    else if (state.project || !$('.hero')) renderHome();
  };
  window.addEventListener('hashchange', async () => { await refreshProjects(); route(); });
  window.addEventListener('focus', () => refreshProjects().catch(() => {}));
  route();
})();
