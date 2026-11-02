// Node canvas setup: registers the bundled fonts once and exposes a canvas factory
// so the shared engine can render off-screen.
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let ready = false;

export function setupFonts() {
  if (ready) return;
  ready = true;
  const files = [
    ['@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff2', 'Lilita One'],
    ['@fontsource/lilita-one/files/lilita-one-latin-ext-400-normal.woff2', 'Lilita One'],
    ['@fontsource/anton/files/anton-latin-400-normal.woff2', 'Anton'],
    ['@fontsource/rubik/files/rubik-latin-400-normal.woff2', 'Rubik'],
    ['@fontsource/rubik/files/rubik-latin-600-normal.woff2', 'Rubik'],
    ['@fontsource/rubik/files/rubik-latin-700-normal.woff2', 'Rubik'],
    ['@fontsource/rubik/files/rubik-latin-800-normal.woff2', 'Rubik'],
    ['@fontsource/rubik/files/rubik-latin-900-normal.woff2', 'Rubik'],
  ];
  for (const [rel, family] of files) {
    try {
      GlobalFonts.registerFromPath(require.resolve(rel), family);
    } catch {
      /* optional weight missing: fall back to system fonts */
    }
  }
}

export const env = { createCanvas: (w, h) => createCanvas(w, h) };
export { createCanvas };
