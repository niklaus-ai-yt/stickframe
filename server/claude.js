// Talking to an AI. Stickframe never calls an AI itself: every step makes a prompt, and the reply comes
// back from outside, in one of two ways (Settings, "claudeMode"):
//   manual - the user pastes the prompt into any AI chatbot and pastes the reply back
//   mcp    - the Claude app, connected over MCP (bin/stickframe-mcp.js), reads the prompt and sends its reply
import { getSettings } from './store.js';

export class ManualNeeded extends Error {
  constructor(prompt, info = {}) {
    super('manual');
    this.prompt = prompt;
    this.info = info;
  }
}

export function manualPrompt(system, user) {
  return `${system}

---

${user}`;
}

// Return the reply when there is one, otherwise hand the prompt back as ManualNeeded.
export async function ask(system, user, { manualReply } = {}) {
  if (manualReply != null && String(manualReply).trim()) return String(manualReply);
  throw new ManualNeeded(manualPrompt(system, user));
}

// Pull the JSON object out of a reply (fenced or bare), tolerating small mistakes.
export function extractJson(text) {
  const s = String(text || '');
  const candidates = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fence.exec(s))) candidates.push(m[1]);
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(s.slice(a, b + 1));
  for (const c of candidates.sort((x, y) => y.length - x.length)) {
    for (const fix of [(x) => x, (x) => x.replace(/,\s*([}\]])/g, '$1'), (x) => x.replace(/,\s*([}\]])/g, '$1').replace(/\/\/[^\n"]*\n/g, '\n')]) {
      try { return JSON.parse(fix(c.trim())); } catch { /* next */ }
    }
  }
  throw new Error('The reply did not contain valid JSON. Try again, and paste the whole reply including the ```json part.');
}

export async function askJson(system, user, opts = {}) {
  return extractJson(await ask(system, user, opts));
}

// The last time the Claude app said hello over MCP (in memory: it reconnects whenever Claude starts).
let mcpSeen = 0;
export function mcpHello() { mcpSeen = Date.now(); }
export function mcpStatus() { return { connected: !!mcpSeen, lastSeen: mcpSeen || null }; }

export async function checkConnection() {
  const s = getSettings();
  if (s.claudeMode === 'manual') return { ok: true, mode: 'manual', note: 'Copy & paste mode: no connection needed.' };
  const m = mcpStatus();
  return m.connected
    ? { ok: true, mode: 'mcp', note: 'Claude is connected.' }
    : { ok: false, mode: 'mcp', note: 'Claude has not connected yet. Install the Claude extension, then open the Claude app.' };
}
