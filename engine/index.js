// Public entry point of the Stickframe animation engine (browser + Node).
export { compileFilm, renderFrame, shotIndexAt, stageFor, inspectFrame, framingWarnings } from './film.js';
export { catalog, CAMERA_SHOTS, CAMERA_MOVES, TRANSITIONS, SFX, SFX_IDS, MUSIC_MOODS } from './catalog.js';
export { LOOKS, LOOK_IDS, getLook } from './looks.js';
export { buildCaptionChunks } from './overlays.js';
export { validateStoryboard } from './validate.js';
