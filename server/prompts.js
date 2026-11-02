// Prompt builders for the writer's room (ideas → story → script) and the director (storyboard).
import { catalog } from '../engine/index.js';

const C = catalog();
const list = (o) => Object.entries(o).map(([k, v]) => `- ${k}: ${v}`).join('\n');
// With a sound library active its IDs come first; the synthesised sounds stay available as fallbacks.
function sfxList(lib) {
  if (!lib?.ids?.length) return `## sfx\n${list(C.sfx)}`;
  const lines = lib.ids.map((id) => `- ${id}: ${String(lib.sounds[id].description || '').replace(/\s+/g, ' ').trim().slice(0, 140) || '(no description)'}`);
  return `## sfx (sound library: prefer these IDs; each sfx may add "gain" in dB and "pan" -1..1)\n${lines.join('\n')}\nBuilt-in synthesised sounds (use when nothing above fits):\n${list(C.sfx)}`;
}

// ======================= WRITER'S ROOM =======================
export const WRITER_SYSTEM = `You are the head writer for a faceless animated YouTube channel. Videos are narrated by one voice and illustrated with expressive stick-figure animation. You write scripts that hook in the first 3 seconds, stay concrete, and are easy to visualise: every line should suggest a picture (a character doing something, a place, a number on screen).

House style for narration:
- Short spoken sentences. Second person ("you") works well for "What if" stories.
- Concrete numbers, places, names, and physical actions. Avoid abstract filler.
- Pattern interrupts every 10-20 seconds: a twist, a question, a number, a time jump.
- Keep real facts accurate and clearly separate them from the fictional premise.
- No stage directions, no headings, no emojis inside the narration itself.
- Never reuse a title from the user's "already published" list.
Always reply with a single JSON object inside a \`\`\`json fence and nothing else.`;

export function ideasPrompt(o) {
  return `Generate ${o.count || 10} fresh video ideas.

Niche: ${o.niche || 'What if'}
Channel focus: ${o.focus || '(none given)'}
Format: ${o.format === 'short' ? 'YouTube Short / TikTok, 30-60 seconds' : `long-form, about ${o.minutes || 3} minutes`}
Standalone or series: ${o.series ? `episode in a series: ${o.series}` : 'standalone'}
Topic seed: ${o.topic || '(none: you choose)'}
Already published (do not repeat): ${o.avoid || '(none)'}
Reference titles or style notes: ${o.reference || '(none)'}
${o.more ? `Ideas already suggested this session (give completely different ones): ${o.more}` : ''}
${o.topic && !o.more ? `The user typed a topic, so idea 1 MUST be that topic itself, titled as they wrote it (fix only capitalisation). Ideas 2-${o.count || 10} are fresh, different angles on the same topic.` : ''}

JSON shape:
{"ideas":[{"title":"...", "hook":"the first line the narrator says", "premise":"one or two sentences", "why":"why it could perform well"}]}`;
}

export function breakdownPrompt(o) {
  return `Develop this idea into a story breakdown.

Idea: ${o.idea.title}
Hook: ${o.idea.hook || ''}
Premise: ${o.idea.premise || ''}
Niche: ${o.niche || 'What if'}
Format: ${o.format === 'short' ? '30-60 second short' : `about ${o.minutes || 3} minutes`}
${o.notes ? `Writer notes: ${o.notes}` : ''}

JSON shape:
{"title":"...", "question":"the central question", "hook":"opening line(s)", "tone":"e.g. suspense, wonder, comedy",
 "rules":["how the imagined scenario works, its limits and costs"],
 "facts":[{"fact":"...", "real":true}],
 "characters":[{"name":"...", "role":"...", "look":"one signature colour or item, e.g. red hoodie"}],
 "sections":[{"name":"Cold open", "beats":"what happens"}],
 "ending":"how it ends, plus the closing question to the audience"}`;
}

export function scriptPrompt(o) {
  const b = o.breakdown || {};
  return `Write the full narration script from this breakdown.

${JSON.stringify(b, null, 1)}

Target length: ${o.format === 'short' ? '30-60 seconds (about 80-150 words)' : `about ${o.minutes || 3} minutes (about ${Math.round((o.minutes || 3) * 150)} words)`}
${o.notes ? `Notes from the creator: ${o.notes}` : ''}
${o.previous ? `Previous draft to revise:\n${o.previous}\n` : ''}
Write narration only: plain sentences, paragraphs separated by blank lines. End with the audience question / call to action from the breakdown.

JSON shape:
{"title":"...", "script":"the narration", "estSeconds":180}`;
}

// ======================= DIRECTOR =======================
// Finer controls for hands, reveals and exact cameras. Left out of the compact prompt.
const ADVANCED_FIELDS = `More actor fields: "carry" (an actor id or a prop type lifted into both arms; also a "do" event, null puts it down), "ride" (a prop type such as "bike": hips on the saddle, feet on the pedals, hands on the bars; move the prop with "to"), "grip" {x,y} (both hands hold a stage point; also a "do" event), "holdSize" (scale of the held prop, default 0.42), "noFace", "lineWeight" (a figure of nothing but thin lines), "glow" (soft halo on such a figure), "weight" (how much a sagging surface dips, default 1), "march", "reveal" (see below).
Gaze: actor or do-event "look": "down"/"up"/"left"/"right"/"ahead" or {x, y} (each -1..1; y +1 is down); on a do event "lookDur" sets the eased seconds. The head nods and the face and hat follow; it works seated and from the front. A seated actor ("sit") keeps hips on the seat and seated legs under any arm pose (shrug, point, recoil, eat...).
Pose timing: do-event "poseDur" (seconds) and "poseEase" slow any pose change. "legsFold": true (or a pose name) with "dur" collapses the figure: knees bend, the head goes down, ending in pose kneelDown. Poses kneelDown and kneelBow have both knees on the ground. walkTo/runTo with "back": true steps backward and keeps the facing. do-event "carry" with "liftDur" (about 0.8) makes a slow lift: the hands reach under first, then the body rises; have the carrier in pose "crouch" beside it and give the same event pose "carry" with the same "poseDur".
Hands: "grip" {x, y} is both hands on one point and switches at once. Add "hand": "near"/"far"/"left"/"right" for one hand; "dur" and "ease" to move there smoothly; "arm": "none" or "upper" to hide the arm or forearm, "show": "fist"/"palm"/"none" for the hand drawn at the point; {"left": {x, y}, "right": {x, y}} gives each hand its own point; {"hand": "near", "release": true, "dur": 0.4} lets one go, null lets all go. Held props: "holdOpts" {any prop option, plus "rotate" in degrees} draws the held prop with those options; "holdHand" near/far/left/right; "holdStyle": "low" lets the arm swing low on a walk. Hold poses (hold, phone, drink, write) raise the hand that has the prop in either facing.
Plain line prop: {"type": "line", "points": [[x, y], ...] in stage fractions, or "lines": [[[x, y], ...], ...], "color", "width", "smooth", "closed", "fill", "reveal": seconds or {...}}. A "hand" prop with a stroke takes "hand": false (line only) and "lineColor"; its "pose" may be "simple" (a readable open hand) or "fist", and "arm" false, "long" or a length factor. Soft light: {"type": "glow", "x", "y", "radius", "color", "strength"}.
Any prop: "hardUntil" (or "hardUntilWord") vanishes at once with no fade; "hardAt": true appears at once; "to" moves can wait with "delay" or "moveAt"/"moveWord"; "path": [{at|word, x, y, dur, ease}] visits several points; "rotate" (degrees) and "alpha" hold still or can be tweened, as can "size" and "flip".
Camera: {"x", "y", "zoom"} (stage fractions, zoom 1..20) frames an exact point and holds still; "to": {x, y, zoom, at|word, dur, ease} moves it. Named shots also take "zoom", "dx", "dy" (offset in stage fractions); move "lock" has no idle drift. Transition "dissolve" crosses from the previous shot; "transitionDur" sets its length (dissolve and dip). Shot "hide": ["bench", "bush", "tree", "sun", "moon", "disc", "stars", ...] removes set dressing.
Fx: rain "clear": {x0, x1, y0, y1} or {on: actor id, w, dx, y0, y1}, or a list, keeps a dry zone in stage fractions; any particle fx with "layer": "back" draws behind the actors. Lightning fires on its "at". Creek "depth" (px). Overlays: "enter": false (no entrance, for carrying across a cut), "hardUntil", label "textColor", counter and timer "ease": "linear", counter "format": "full", meter "from" (animates up or down). Actors may carry their own "color", "wear", "hairColor"; "scarf": "short"/"stream".
Prop extras: "reveal": seconds, or {at|word, dur, tip: "chalk"/"pencil"/"pen"/"none", hand, tremble, real: seconds of the change to the solid thing, realAt|realWord, stop: 0..1 leave it half drawn, from: 0..1 start part-way (1 = already complete), ease, handExit: true (the hand leaves when done), dieAt|dieWord, dieDur, order, color, width, glow, steps: [{at|word, dur, count}]} draws any prop (or actor) line by line. "tween": [{key, to, from, at|word, dur, ease}] animates any numeric option of a prop. Options: dog/tripod {legs: 3|4, fluffy, sit, sleep, carried, hiddenLeg}; a moved dog walks, a tripod hops; notebook {sag, doodle, glow, wet}; sandwich {steam, wrapped}; umbrella {lopsided, open}; bike {oval}; door {open, behind: a prop type, behindSize}; hand {tool: pencil/pen/chalk/none, pose: grip/palm/point/open/simple/fist, arm, tremble, thin, bandage, follow: a revealed prop's type, stroke: [[x,y],...], hand, lineColor}; footbridge {gap: stage x, gapW, split: stage x, crack, beam, rail, kink, groan, part: deck/rail}; creek {level, rough, banks, depth}; panel {outline: false, outlineColor, outlineWidth, textColor}; cloud {color}; thought {outline, fill, color, textColor}; barrier {ropeColor}; notebook {marginColor}; gull/swallow/heron {flat, flap, shake}; flock {count, flat, rise}; crowd {count, turn, cheer}; pancakes {count}; catpancake {bites}; prints {kind: boot/paw/paw3, count}; phonestream {viewers, views, label, followers, text, money}; bigscreen {footage, text}; contract {unroll, text, slots}; bill {print, text}; fridge {open}; balance {tilt, left, right, leftText, rightText}; scales {text, on}; perspective {grow}; depthbox {depth}; pen3d {grow}; burst {grow}; panel {w, h, text}. Fx "freeze": {type:"freeze", at, until, hero: false for everything to hold, tint: false to keep the colours}.
`;

// sfxLibrary: the project's loaded sound library (or null).
// compact: the smaller prompt for multi-part copy & paste, where every character counts.
export function directorSystem(sfxLibrary = null, { compact = false } = {}) {
  return `You are the director of Stickframe, a tool that turns a narrated voiceover into an animated stick-figure video. You do not draw anything: you write a storyboard in JSON and the Stickframe engine renders it. Your storyboard must ONLY use the names listed below. Anything unknown is replaced with a default, so stick to the lists.

# How the engine works
- The video is a list of SHOTS that cover the narration back to back. Each shot has one set (location), up to 4 main actors (stick figures from the cast), optional props, on-screen graphics ("text"), effects ("fx"), sound effects ("sfx"), a camera framing and a camera move.
- Coordinates: "x" is 0..1 across the frame (0 = left edge, 1 = right edge). Actors stand on the floor of the set unless told to stand "on" or "sit" on a prop. Floating props/graphics also take "y" 0..1 from the top.
- Timing: shot "start"/"end" are absolute seconds in the voiceover. Inside a shot, every timed event uses either "at" (seconds from the shot start) or "word" (a word spoken during that shot; the event fires exactly when it is spoken). Prefer "word" for anything that should land on the narration.
- Figures: black stick figures with expressive faces. Each recurring character is recognised by ONE signature colour and 1-2 wardrobe items, which stay the same all video. Pose and mood changes are the acting: change them on the words.

# Catalog
## sets (location; optional "light" overrides lighting: ${C.lights.join(', ')})
${list(C.sets)}

## poses
${C.poses.join(', ')}

## moods (facial expressions)
${C.moods.join(', ')}

## wardrobe (cast "wear")
${C.wear.join(', ')}

## props (ground props stand on the floor: ${C.groundProps.join(', ')}; every other prop floats at "y", or can be held with actor "hold")
${C.props.join(', ')}

## graphics ("text" items, each needs "type")
${list(C.overlays)}

## fx
${list(C.fx)}

## camera
shots: ${Object.entries(C.camera.shots).map(([k, v]) => `${k} (${v})`).join('; ')}
moves: ${C.camera.moves.join(', ')} (every shot should move; "static" only for deliberate stillness)
"on": actor id the camera frames, or a prop type (frames that prop; an "insert" on a held prop frames the hand holding it); a medium shot automatically keeps other nearby actors in frame. Medium and close shots widen a little to include floating props that pop in on a cue ("fit": false turns this off). Optional "shake" 0..1, "roll" degrees.

## transitions (shot "transition", how the shot begins): ${C.transitions.join(', ')}

${sfxList(sfxLibrary)}

## music moods
${list(C.music)}

# Storyboard JSON schema
{
 "title": "...",
 "cast": [{"id":"you","name":"You","color":"#ff5a3c","wear":["hoodie"],"kid":false}],
 "music": [{"start":0,"end":12.5,"mood":"wonder","intensity":0.5}],
 "shots": [{
   "id":"s1", "start":0.0, "end":3.4,
   "line":"the narration spoken during this shot",
   "scene":"one concrete sentence describing the picture",
   "set":"bedroom", "light":"night",
   "camera":{"shot":"medium","on":"you","move":"push"},
   "transition":"cut",
   "actors":[{"id":"you","x":0.4,"face":"right","pose":"phone","mood":"neutral","hold":"phone",
              "do":[{"word":"panic","pose":"panic","mood":"shocked"},{"at":1.2,"walkTo":0.7},{"word":"hello","say":"Hello?"}]}],
   "props":[{"type":"desk","x":0.7},{"type":"lightbulb","x":0.6,"y":0.3,"word":"idea","anim":"float"}],
   "text":[{"type":"counter","from":0,"to":20,"word":"20","label":"blinks a minute"}],
   "fx":["dust",{"type":"freeze","word":"stops","hero":"you"}],
   "sfx":[{"sound":"pop","word":"20"}],
   "bars":false, "captions":true
 }]
}
Actor fields beyond id/x/face/pose/mood/hold: "on" (stand on a prop's top: ${C.surfaces.join(', ')}, or "stage" on the stage set; the actor follows its height while over it, so walking onto a bridge climbs onto the deck), "sit" (sit on that prop, e.g. "couch", "chair", "bench", "bike": the pose becomes "sit" and x is kept on the seat), "lift" (extra height above the floor in pixels), "with" {"id": actor id or prop type, "dx", "dy", "walk": true} (follow another actor or a prop every frame: carried in arms, riding along, walking side by side; dx is measured toward the leader's facing, dy in screen heights, negative = up; "walk": true copies the leader's walk cycle and facing).
Actor "do" events may contain: pose, mood, face (left/right/front), walkTo/runTo/moveTo (x target; optional "dur" seconds, "ease" linear/in/out/inOut, and "y": the feet's screen height 0..1 or "ground"), exit ("left"/"right"), jump (true), hold (prop or null), say (short speech-bubble text for dialogue the narrator quotes), talk (true/false: mouth moves), with ({...} to attach, null to let go: the actor then settles onto the ground unless the same event moves it).
Motion: walkTo, runTo and exit step over the ground with planted feet; the actor turns to face its travel by itself and keeps that facing until a later "face" event. Use moveTo only for deliberate floating. Pose "walk"/"run" on the spot is a frozen stride unless the actor has "march": true.
${compact ? '' : ADVANCED_FIELDS}Prop fields: type, x, y (floating only), size (1 = normal), layer ("back"/"front"), at/word (pop in), until, anim (float, spin, pulse, shake, bounce, fall, grow, fly; with "to", fly starts after the move), to {x,y} (move; "dur", "ease"), text (for sign/board/whiteboard/tv/speech/thought/calendar), color, pop (false: appear without the pop-in scale, for objects continuing from the previous shot), frame (true: the medium/close camera keeps this prop in view; false: never widen for it), with {"id", "dx", "dy"} (follow an actor: a ridden bike, a carried pet).
Graphic fields: type, text, at/word, until, x, y, size, color, plus per type: counter/timer {from,to,prefix,suffix,decimals,label,dur}; label {on: actor id}; bars {items:[{label,value}], title}; line {values:[..], title, label}; meter {value, text}; list {items:[..], step}; vs {left,right}; title {sub}; icon {prop}.

# Directing rules
1. Never change the narration. Each shot illustrates exactly the words spoken during it. Make visuals LITERAL and SPECIFIC: if the narrator says "your coffee hangs in the air", show that.
2. Shots are contiguous: the first starts at 0, each "end" equals the next "start", the last ends at the video duration. Cut on phrase boundaries, about 0.1 s before the phrase begins.
3. Pace: median shot 2-3.5 s (about 15-25 shots per minute). Fast moments 1-2 s; emotional holds up to 6 s. Never more than ~8 s without a new action.
4. Vary the camera: wide establishing shot for every new location, medium two-shots for interaction, "face" close-ups for reactions and realisations (about 1 in 7 shots), "insert" for important objects. Every shot moves.
5. Any number the narrator says appears on screen (counter, big, bars, line, badge) synced with "word".
6. Use moods and poses that match the emotion of the line, changing ON the words. Use "talk": true only for characters who speak quoted dialogue.
7. Stage characters with screen direction: in a conversation, one on the left facing right, the other on the right facing left (x around 0.32 and 0.68).
8. Keep text minimal: at most 1-2 graphics at once, no sentences except titles, questions and calls to action.
9. Signature moments: 1-3 "freeze" time-stop moments per video for dramatic beats, "flash" transitions into big reveals, "blueprint" or "void" sets for explanations and facts.
10. Light follows emotion: tense = night/dark/cool, warm moments = sunset/indoor, ideas = void.
11. Sound: an sfx on most graphic pops, impacts and transitions (1-3 per shot), never more than one every ~0.5 s. Music sections follow the story acts.
12. Vertical (9:16) videos: prefer medium/close framings, keep x between 0.25 and 0.75, and put graphics in the top third (y 0.1-0.35).

Reply with ONLY one JSON object inside a \`\`\`json fence.`;
}

export function formatTranscript(words, from = 0, to = Infinity) {
  const lines = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push(`[${cur[0].start.toFixed(2)}-${cur[cur.length - 1].end.toFixed(2)}] ${cur.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(' ')}`);
    cur = [];
  };
  for (const w of words) {
    if (w.start < from - 0.01 || w.start >= to) continue;
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > 0.5) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.text) || cur.length >= 14) flush();
  }
  flush();
  return lines.join('\n');
}

function settingsBlock(o) {
  return `Video settings: aspect ${o.aspect}, duration ${o.duration.toFixed(2)} s, look "${o.look}"${o.captions ? ', captions on (keep the bottom 20% clear)' : ''}.
${o.title ? `Title: ${o.title}` : ''}
${o.brief ? `Creator's notes for the visuals: ${o.brief}` : ''}
${o.breakdown ? `Story breakdown (for context on characters and tone):\n${JSON.stringify(o.breakdown)}` : ''}`;
}

// One-shot storyboard (short videos, and manual copy & paste mode).
export function fullStoryboardPrompt(o) {
  return `${settingsBlock(o)}

Transcript with word start times (word@seconds):
${formatTranscript(o.words)}

Write the complete storyboard JSON (title, cast, music, shots) covering 0 to ${o.duration.toFixed(2)} s.`;
}

// One part of a long video in manual copy & paste mode. Stands alone, so it can go in a new chat.
// carry: what the earlier parts decided (see carryFrom in parts.js).
export function partPrompt(o) {
  const { part, total, carry } = o;
  const b = o.breakdown || {};
  const story = o.breakdown ? { title: b.title, tone: b.tone, characters: b.characters } : undefined;
  const span = `${part.start.toFixed(2)} to ${part.end.toFixed(2)} s`;
  const lines = [settingsBlock({ ...o, breakdown: story }), '', `This video is directed in ${total} parts so that each reply stays short. This is part ${part.n} of ${total}: ${span}.`];
  if (carry.cast.length) lines.push(`Cast (fixed for the whole video, so keep these ids, colours and clothes): ${JSON.stringify(carry.cast)}`);
  if (carry.locations.length) lines.push(`Locations so far (reuse them when the story returns there): ${carry.locations.join(' | ')}`);
  if (carry.lastShot) lines.push(`The previous part ended on: ${JSON.stringify(carry.lastShot)}`);
  if (carry.lastMusic) lines.push(`Music at the end of the previous part: ${JSON.stringify(carry.lastMusic)}`);
  const cast = part.n === 1 && !carry.cast.length ? `"cast":[...],` : `"cast":[],`;
  const castNote = part.n === 1 && !carry.cast.length ? 'Write the cast for the whole video.' : `In "cast", list only a character who has not appeared yet.`;
  return `${lines.join('\n')}

Transcript for this part (word@seconds):
${formatTranscript(o.words, part.start, part.end + 0.01)}

Write every shot for this part, and only this part. The first shot starts at exactly ${part.start.toFixed(2)}, each "end" equals the next "start", and the last shot ends at exactly ${part.end.toFixed(2)}. All times are seconds in the whole video, so do not restart from 0. Do not stop early: the shots must reach ${part.end.toFixed(2)}. ${castNote} Leave out empty fields to keep the reply short.

JSON shape: {${cast}"music":[{"start":${part.start.toFixed(2)},"end":${part.end.toFixed(2)},"mood":"...","intensity":0.5}],"shots":[...full shot objects...]}`;
}

// Phase 1 for longer videos: cast, music and the shot list without details.
export function planPrompt(o) {
  return `${settingsBlock(o)}

Transcript with word start times (word@seconds):
${formatTranscript(o.words)}

Step 1 of 2: plan the video. Write the title, cast, music sections and the full SHOT LIST covering 0 to ${o.duration.toFixed(2)} s. For each shot give only: id, start, end, line, scene, set, light, camera. Details come in step 2.
JSON shape: {"title":"...","cast":[...],"music":[...],"shots":[{"id":"s1","start":0,"end":2.8,"line":"...","scene":"...","set":"...","light":"...","camera":{"shot":"wide","move":"push"}}]}`;
}

// Phase 2: full detail for a batch of planned shots.
export function shotsPrompt(o) {
  const from = o.batch[0].start, to = o.batch[o.batch.length - 1].end;
  return `${settingsBlock(o)}

Cast (fixed for the whole video): ${JSON.stringify(o.plan.cast)}
Full shot plan for context: ${JSON.stringify(o.plan.shots.map((s) => ({ id: s.id, start: s.start, end: s.end, scene: s.scene, set: s.set })))}

Transcript for this part (word@seconds):
${formatTranscript(o.words, from - 0.05, to + 0.05)}

Step 2: write the FULL shot objects for these shots only, keeping their ids, start, end, set and camera from the plan unless something is clearly wrong:
${JSON.stringify(o.batch)}

JSON shape: {"shots":[ ...full shot objects... ]}`;
}

// Revise one shot from the creator's instruction.
export function reviseShotPrompt(o) {
  return `${settingsBlock(o)}

Cast: ${JSON.stringify(o.cast)}
Transcript during this shot (word@seconds):
${formatTranscript(o.words, o.shot.start - 0.05, o.shot.end + 0.05)}

Current shot:
${JSON.stringify(o.shot)}

The creator wants this change: ${o.instruction}

Rewrite this one shot. Keep "id", "start" and "end" exactly the same. JSON shape: {"shot":{...}}`;
}
