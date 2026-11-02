// Talks to bin/stickframe-mcp.js the way the Claude app does (MCP over stdio) and runs the first steps of a video.
// Usage: STICKFRAME_PORT=4891 STICKFRAME_HOME=/tmp/sf node tools/mcp_test.mjs
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['bin/stickframe-mcp.js'], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
let buf = '', next = 1;
const waiting = new Map();
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    waiting.get(msg.id)?.(msg);
  }
});
const rpc = (method, params) => new Promise((resolve) => { const id = next++; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const tool = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error);
  console.log(`\n## ${name}${r.result?.isError ? ' (ERROR)' : ''}\n${text.length > 600 ? text.slice(0, 300) + `\n... [${text.length} chars] ...\n` + text.slice(-250) : text}`);
  return text;
};

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
console.log('initialize:', init.result.serverInfo, init.result.protocolVersion);
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
console.log('tools:', (await rpc('tools/list', {})).result.tools.map((t) => t.name).join(', '));
await tool('stickframe_status');
const made = await tool('create_project', { title: 'MCP test', resolution: '720p' });
const id = /Project id: (\S+)/.exec(made)[1];
await tool('writer_prompt', { project: id, step: 'ideas', niche: 'What if', format: 'long', minutes: 1, topic: 'What if the internet shut down for a week?' });
const ideas = { ideas: Array.from({ length: 10 }, (_, k) => ({ title: k ? `Idea ${k + 1}` : 'What if the internet shut down for a week?', hook: 'Hook', premise: 'Premise', why: 'Why' })) };
await tool('writer_submit', { project: id, step: 'ideas', reply: '```json\n' + JSON.stringify(ideas) + '\n```' });
await tool('writer_prompt', { project: id, step: 'breakdown', idea_number: 1 });
await tool('update_project', { project: id, look: 'moonlight', music_volume: 0.4, director_notes: 'Keep it tense but hopeful.' });
await tool('get_project', { project: id });
await tool('nope');
child.stdin.end();
