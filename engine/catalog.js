// Single source of truth for everything a storyboard may reference.
// The prompt builder, the validator and the UI all read from here.
import { POSE_IDS, MOOD_IDS, WEAR } from './rig.js';
import { PROP_IDS, PROPS, SURFACE_PROPS } from './props.js';
import { SETS, SET_IDS } from './sets.js';
import { FX, FX_IDS } from './fx.js';
import { OVERLAY_TYPES } from './overlays.js';
import { LOOKS, LOOK_IDS, LIGHTS } from './looks.js';

export const CAMERA_SHOTS = {
  wide: 'whole location, figures small',
  medium: 'full body of the target with some room',
  close: 'upper body of the target',
  face: 'giant face close-up of the target (reactions, realisations, "you" moments)',
  insert: 'big close-up on a prop (set "on" to the prop type)',
};
export const CAMERA_MOVES = ['push', 'pull', 'left', 'right', 'up', 'down', 'drift', 'static', 'lock'];
export const TRANSITIONS = ['cut', 'fade', 'dip', 'flash', 'whip', 'zoom', 'wipe', 'dissolve'];
// Fields an actor, a "do" event, a shot or a camera may carry beyond the names listed in the catalog.
export const SCENE_FIELDS = {
  actor: ['look', 'grip', 'hold', 'holdOpts', 'holdSize', 'holdHand', 'holdStyle', 'color', 'wear', 'hairColor', 'scarf'],
  do: ['look', 'lookDur', 'poseDur', 'poseEase', 'legsFold', 'dur', 'back', 'keepFace', 'liftDur', 'grip', 'holdOpts', 'holdSize', 'holdHand', 'holdStyle'],
  shot: ['hide', 'transitionDur'],
  camera: ['x', 'y', 'zoom', 'to', 'dx', 'dy'],
  prop: ['hardUntil', 'hardUntilWord', 'hardAt', 'delay', 'moveAt', 'moveWord', 'path', 'rotate', 'alpha'],
  overlay: ['enter', 'textColor', 'hardUntil', 'ease', 'from', 'format'],
  fx: ['clear', 'layer'],
};

export const SFX = {
  whoosh: 'fast air swish (movement, transitions)',
  pop: 'soft pop (graphics appearing)',
  ding: 'bright bell (correct, idea, notification)',
  boom: 'deep impact (big reveal, crash)',
  thud: 'body/object hitting the ground',
  click: 'small click (button, switch)',
  riser: 'rising tension swell (lead-in to a reveal)',
  heartbeat: 'two-beat heartbeat',
  tick: 'clock tick',
  cash: 'cash register ka-ching',
  glitch: 'digital glitch',
  sparkle: 'magical shimmer',
  splash: 'water splash',
  step: 'footstep',
  typing: 'keyboard typing burst',
  alarm: 'alarm beeps',
  buzz: 'wrong-answer buzzer',
  success: 'happy rising chime',
  fail: 'sad falling trombone-like tones',
  shutter: 'camera shutter',
  freeze: 'icy time-stop shimmer',
  swoosh: 'soft long swoosh (scene change)',
  punch: 'punchy hit',
  laugh: 'short giggle-like blips',
  crowd: 'crowd roar swell',
  thunder: 'thunder rumble',
  phone: 'phone vibration buzz',
  door: 'door knock',
};
export const SFX_IDS = Object.keys(SFX);

export const MUSIC_MOODS = {
  calm: 'gentle pads, slow',
  wonder: 'bright, curious, sparkling',
  upbeat: 'light groove, positive',
  tense: 'pulsing low drone, suspense',
  sad: 'slow minor chords',
  epic: 'big drums and swelling chords',
  mystery: 'sparse, eerie, minor',
  playful: 'bouncy plucks, comedic',
};

export function catalog() {
  return {
    looks: Object.fromEntries(LOOK_IDS.map((k) => [k, LOOKS[k].blurb])),
    lights: LIGHTS,
    sets: Object.fromEntries(SET_IDS.map((k) => [k, `${SETS[k].desc} (default light: ${SETS[k].light})`])),
    poses: POSE_IDS,
    moods: MOOD_IDS,
    wear: WEAR,
    props: PROP_IDS,
    groundProps: PROP_IDS.filter((p) => PROPS[p].ground),
    surfaces: SURFACE_PROPS,
    fx: FX,
    overlays: OVERLAY_TYPES,
    camera: { shots: CAMERA_SHOTS, moves: CAMERA_MOVES },
    transitions: TRANSITIONS,
    fields: SCENE_FIELDS,
    sfx: SFX,
    music: MUSIC_MOODS,
  };
}

export { POSE_IDS, MOOD_IDS, WEAR, PROP_IDS, SET_IDS, FX_IDS, LOOK_IDS, LIGHTS };
