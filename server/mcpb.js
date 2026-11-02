// The Claude extension (.mcpb): a zip the Claude desktop app installs with a double-click. It holds a
// manifest and a two-line starter that runs bin/stickframe-mcp.js from this install, so the bundle is
// made on request with this computer's folder, port and data folder written in.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TOOLS } from './mcp-tools.js';

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// A plain zip writer (stored, no compression): the bundle is a few kilobytes.
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

export function extensionBundle({ root, port, home, version }) {
  const server = path.join(root, 'bin', 'stickframe-mcp.js');
  const env = { STICKFRAME_PORT: String(port), STICKFRAME_HOME: home };
  const manifest = {
    manifest_version: '0.2',
    name: 'stickframe',
    display_name: 'StickFrame',
    version,
    description: 'Make stick-figure videos with StickFrame. Claude writes, directs and renders them on your computer.',
    long_description: 'Connects Claude to the StickFrame app on this computer. Claude can brainstorm ideas, write the script, time your voiceover, direct every shot, change shots in plain English and render the finished MP4. Everything runs locally.',
    author: { name: 'StickFrame' },
    server: { type: 'node', entry_point: 'server/index.js', mcp_config: { command: 'node', args: [server], env } },
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    compatibility: { platforms: ['win32', 'darwin', 'linux'], runtimes: { node: '>=20.0.0' } },
  };
  const starter = `// Starts the StickFrame MCP server that ships with the app installed at ${root}\nObject.assign(process.env, ${JSON.stringify(env)});\nawait import(${JSON.stringify(pathToFileURL(server).href)});\n`;
  return zip({ 'manifest.json': JSON.stringify(manifest, null, 2), 'server/index.js': starter, 'package.json': JSON.stringify({ type: 'module', private: true }) });
}
