---
name: stickframe
description: Make a finished animated stick-figure video (MP4) from a topic or a script with Stickframe. Use when the user asks for a stick-figure animation, a what-if video, or runs /stickframe.
argument-hint: "[topic, or path to a script or voiceover]"
---

# Make a Stickframe video

Topic or file from the user: $ARGUMENTS

You are the writer and the director. Stickframe does the rendering. Every step goes through `node bin/sf.js`, run from the root of this repository. Run `node bin/sf.js help` if you need the full list.

## 1. Settings

Unless the user said otherwise, use: 16:9, 1080p, the `ember` look, no captions, about 60 seconds, generated music and sound effects. State these in one line and continue. Do not ask about them unless the request is unclear.

Run `node bin/sf.js status`. If it says ffmpeg is not found, stop and tell the user to install it (see the README). Run `node bin/sf.js mode manual`, so that Stickframe waits for your storyboard and you direct the video yourself.

## 2. Script

If the user gave a script file, use it unchanged. Otherwise write one for the topic: short spoken sentences, second person for "what if" stories, a hook in the first line, something concrete to picture in every line, and a question to the audience at the end. No stage directions or headings. About 150 words a minute. Keep real facts accurate and do not invent statistics.

Save it as `script.txt` in a new folder `output/<slug>/`, then create the project:

```
node bin/sf.js new "Title" --aspect 16:9 --resolution 1080p --look ember
node bin/sf.js script <id> output/<slug>/script.txt
```

`new` prints the project id.

## 3. Voice and timing

Use the first of these that applies:

1. The user gave a voiceover file: `node bin/sf.js voice <id> <file>`, then `node bin/sf.js transcribe <id>`.
2. Otherwise use the free built-in voice: `node bin/sf.js say <id>`. It also times the words. Tell the user this is the draft voice and they can swap in a better one.

The first transcription downloads a speech model of about 290 MB.

## 4. Storyboard

```
node bin/sf.js prompt <id> --whole --out output/<slug>/prompt.txt
```

Read that file. It is your brief: the engine's full catalog, the rules, and the transcript with word timings. Follow it as if it were your system prompt, and write the storyboard JSON it asks for to `output/<slug>/storyboard.json`. Use only names from the catalog. Apply it:

```
node bin/sf.js storyboard <id> output/<slug>/storyboard.json --whole
```

Read any warnings it prints. Warnings mean something was replaced with a default, so fix the JSON and apply it again if a warning changes what the viewer sees.

## 5. Check, then render

Render a short preview first and look at a frame from it:

```
node bin/sf.js render <id> --preview --from 0 --to 10 --out output/<slug>/preview.mp4
ffmpeg -y -ss 3 -i output/<slug>/preview.mp4 -frames:v 1 output/<slug>/preview.png
```

Read the PNG. If it looks wrong, fix the storyboard and repeat. To change one shot, edit the JSON and apply it again. Then render the full video:

```
node bin/sf.js render <id> --out output/<slug>/<slug>.mp4
```

## 6. Finish

Tell the user where the MP4 is, how long it is, which voice it uses, and anything you changed or could not do. To change the look later: `node bin/sf.js set <id> look=sketchbook`, then render again. Looks are `ember`, `moonlight`, `sketchbook`, `chalkboard` and `candy`.
