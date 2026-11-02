// The tools StickFrame offers the Claude app over MCP (bin/stickframe-mcp.js runs them). Kept apart so the
// server can list them in the Claude extension's manifest without starting an MCP connection.
const project = { type: 'string', description: 'Project id (from create_project or list_projects)' };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  { name: 'stickframe_status', description: 'Check that StickFrame is running: version, data folder, ffmpeg, AI mode. Starts the app if it is not running.', inputSchema: obj({}) },
  { name: 'list_projects', description: 'List the videos in StickFrame.', inputSchema: obj({}) },
  { name: 'create_project', description: 'Create a new video project. Returns its id.',
    inputSchema: obj({ title: { type: 'string' }, aspect: { type: 'string', enum: ['16:9', '9:16'] }, resolution: { type: 'string', enum: ['720p', '1080p', '1440p', '4k'] }, look: { type: 'string', enum: ['ember', 'moonlight', 'paper', 'chalk', 'candy'] }, captions: { type: 'boolean' } }, ['title']) },
  { name: 'get_project', description: 'Everything about one project: settings, writer progress, script, voice, timing, storyboard and renders.', inputSchema: obj({ project }, ['project']) },
  { name: 'update_project', description: 'Change project settings. music_mode is auto (generated to fit the story), file or none; music_volume is 0 to 1. director_notes are passed to the storyboard step.',
    inputSchema: obj({ project, title: { type: 'string' }, aspect: { type: 'string', enum: ['16:9', '9:16'] }, resolution: { type: 'string', enum: ['720p', '1080p', '1440p', '4k'] }, fps: { type: 'number', enum: [24, 30, 60] }, look: { type: 'string', enum: ['ember', 'moonlight', 'paper', 'chalk', 'candy'] }, captions: { type: 'boolean' }, sfx: { type: 'boolean' }, music_mode: { type: 'string', enum: ['auto', 'file', 'none'] }, music_volume: { type: 'number' }, script: { type: 'string' }, director_notes: { type: 'string' } }, ['project']) },
  { name: 'writer_prompt', description: "Get StickFrame's writer prompt for a step: ideas (10 video ideas), breakdown (the story bible for one idea) or script (the narration). Answer the prompt yourself, exactly in the JSON format it asks for, then call writer_submit with your reply. For breakdown, pass idea_number from the ideas list.",
    inputSchema: obj({ project, step: { type: 'string', enum: ['ideas', 'breakdown', 'script'] }, niche: { type: 'string' }, format: { type: 'string', enum: ['long', 'short'] }, minutes: { type: 'number' }, topic: { type: 'string' }, idea_number: { type: 'number' }, notes: { type: 'string' } }, ['project', 'step']) },
  { name: 'writer_submit', description: 'Send your reply to a writer_prompt back to StickFrame. Pass the same step (and idea_number for breakdown).',
    inputSchema: obj({ project, step: { type: 'string', enum: ['ideas', 'breakdown', 'script'] }, reply: { type: 'string' }, idea_number: { type: 'number' }, notes: { type: 'string' } }, ['project', 'step', 'reply']) },
  { name: 'set_voice', description: 'Use an audio file on this computer (mp3, wav, m4a...) as the voiceover. Give the full path.', inputSchema: obj({ project, file: { type: 'string' } }, ['project', 'file']) },
  { name: 'draft_voice', description: "Make a free draft voiceover from the script with this computer's built-in voice, and time it. For testing only.", inputSchema: obj({ project }, ['project']) },
  { name: 'transcribe', description: 'Time every word of the voiceover with local speech recognition (runs on this computer). Needed before directing.', inputSchema: obj({ project, model: { type: 'string' } }, ['project']) },
  { name: 'director_prompt', description: "Get StickFrame's director prompt: the narration with the exact time of every word, and the rules for the storyboard. Answer it yourself with the complete storyboard JSON it asks for, then call director_submit.", inputSchema: obj({ project }, ['project']) },
  { name: 'director_submit', description: 'Send your storyboard JSON back. StickFrame checks it and reports the number of shots and any warnings to fix.', inputSchema: obj({ project, storyboard: { type: 'string', description: 'Your whole reply, including the JSON' } }, ['project', 'storyboard']) },
  { name: 'list_shots', description: 'The storyboard as a short list: shot id, time, location, camera and what happens. Use it to find the shot to change.', inputSchema: obj({ project }, ['project']) },
  { name: 'revise_prompt', description: 'Get the prompt for changing one shot in plain English. Answer it, then call revise_submit.', inputSchema: obj({ project, shot: { type: 'string' }, change: { type: 'string' } }, ['project', 'shot', 'change']) },
  { name: 'revise_submit', description: 'Send your changed shot back.', inputSchema: obj({ project, shot: { type: 'string' }, change: { type: 'string' }, reply: { type: 'string' } }, ['project', 'shot', 'change', 'reply']) },
  { name: 'render', description: 'Render the video to MP4. preview renders a short clip at half size; from/to (seconds) pick a range. Returns the file, or a job id to check with job_status if it takes longer than a minute.', inputSchema: obj({ project, preview: { type: 'boolean' }, from: { type: 'number' }, to: { type: 'number' } }, ['project']) },
  { name: 'job_status', description: 'Progress of a render (or another long job) by its job id.', inputSchema: obj({ job: { type: 'string' } }, ['job']) },
  { name: 'open_in_browser', description: 'Open StickFrame in the browser, on a project if one is given, so the user can watch the preview or change things by hand.', inputSchema: obj({ project: { type: 'string' } }) },
];
