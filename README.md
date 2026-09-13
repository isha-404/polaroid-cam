# OPTIC—01

A browser-based camera app with a retro camcorder aesthetic. It uses the browser's camera and microphone APIs to capture photos as Polaroid-style prints and record short video clips, all without external media files or libraries.

## Overview

The app uses a single `MediaStream` from the user's camera and routes it into two capture pipelines:

```text
Camera
  │
  ▼
MediaStream
  │
  ├──► <video> ──► Live preview
  │
  ├──► Canvas ──► JPEG ──► Polaroid composition ──► Download
  │
  └──► MediaRecorder ──► Chunks ──► Blob ──► Clip player/download
```

The interface is built as layered UI around these two capture paths, including a HUD, film roll, lightbox, flash effect, film grain, and camcorder-style controls.

## Features

- Live camera preview
- Camera and microphone access through `getUserMedia()`
- Photo capture using an off-screen canvas
- Optional mirrored photo output to match the preview
- Polaroid-style photo compositor
- JPEG photo downloads
- Video recording with `MediaRecorder`
- Automatic MIME-type selection for browser compatibility
- Clip playback and downloads
- Film-roll gallery for captured media
- Lightbox preview
- Generated shutter and recording sounds using the Web Audio API
- Keyboard shortcuts
- Toast notifications
- Camera power-on / power-off state
- Retro camcorder visual effects

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- Canvas API
- MediaDevices API
- MediaRecorder API
- Web Audio API

No external media files are required for the sound effects or film-grain texture.

## How It Works

### 1. Interface Structure

The camera view is composed of several stacked layers:

```html
<div class="viewfinder">
  <video>              <!-- live camera -->
  <div class="fx">     <!-- scanlines + grid -->
  <div class="hud">    <!-- REC indicator, timecode, corners -->
  <div class="flash">  <!-- capture flash -->
  <div class="offline"> <!-- power-off screen -->
</div>

<canvas id="work" hidden></canvas>
```

The `<video>` element displays the live stream, while the hidden canvas acts as an off-screen workbench for capturing and processing frames.

### 2. Camera Access

The camera is initialized with `navigator.mediaDevices.getUserMedia()`:

```js
stream = await navigator.mediaDevices.getUserMedia({
  video: {...},
  audio: true
});

video.srcObject = stream;
```

The app first requests both video and audio. If microphone access is unavailable, it can fall back to video-only access.

Common camera errors are mapped to user-friendly messages, including permission denial, missing cameras, and cameras that are already in use.

When the camera is powered off, its tracks are explicitly stopped:

```js
stream.getTracks().forEach(t => t.stop());
```

> Camera access requires a secure context such as HTTPS or `localhost`.

### 3. State Management

The interface uses three main states:

```text
off → live → rec
```

A central `setState()` function controls the visual state, status indicators, and button availability. Keeping these rules in one place prevents different controls from developing conflicting state logic.

### 4. Photo Capture

A video element cannot be downloaded directly as an image. Instead, the current video frame is copied to the hidden canvas:

```js
const ctx = work.getContext('2d');

if (mirror) {
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
}

ctx.drawImage(video, 0, 0, w, h);

const src = work.toDataURL('image/jpeg', 0.92);
```

The canvas provides the captured pixels, which are then exported as a JPEG data URL.

The capture process also handles the camera flash animation and prevents additional captures while the Polaroid eject animation is running.

### 5. Polaroid Compositor

Captured photos are converted into complete Polaroid-style images before download.

The compositor:

1. Calculates paper dimensions relative to the photo resolution.
2. Creates the paper background.
3. Applies a subtle generated grain texture.
4. Places the captured photo on the paper.
5. Adds a thin photo border.
6. Prints the caption and shot number.
7. Exports the final composition as a JPEG.

Example geometry:

```js
const pad = Math.round(w * 0.052);
const capH = Math.max(54, h * 0.16);

const cw = w + pad * 2;
const ch = h + pad + capH;
```

The completed Polaroid is cached on the shot object, so reopening or downloading the same photo does not require recompositing it.

### 6. Video Recording

Video recording uses the same camera stream through `MediaRecorder`:

```js
recorder = new MediaRecorder(stream, { mimeType: mime });

recorder.ondataavailable = e => chunks.push(e.data);

recorder.start();
```

Because browsers support different recording formats, the app checks `MediaRecorder.isTypeSupported()` and selects an appropriate MIME type.

When recording stops, the chunks are combined into a `Blob`:

```js
const blob = new Blob(chunks, { type: mime });
```

An object URL is then created for playback and downloading:

```js
const url = URL.createObjectURL(blob);
```

Object URLs are revoked when clips are deleted to avoid keeping unnecessary media in memory.

### 7. Clip Poster Generation

Some WebM recordings may not expose their duration correctly through `video.duration`. The app works around this when generating a poster frame by seeking far beyond the expected end of the recording, allowing the browser to resolve the media duration before seeking to an early frame.

The app also tracks recording duration independently with `performance.now()` so the displayed clip duration remains reliable.

### 8. Photo vs. Video Data

The two capture paths use different browser data formats:

| | Photos | Clips |
|---|---|---|
| Storage format | Data URL | Object URL |
| Source | Canvas | Blob |
| Main API | Canvas API | MediaRecorder API |
| Cleanup | Browser-managed | `URL.revokeObjectURL()` |

## Film Roll

Captured media is represented as shot objects stored in a `Map`.

A photo entry contains information such as:

```js
{
  kind: 'photo',
  src: 'data:image/jpeg...',
  n: 1,
  clock: '14:23:07',
  date: '2024.06.14',
  name: 'OPTIC01_....jpg',
  pol: null,
  el: cardElement
}
```

Using a `Map` provides quick lookup when downloading, opening, or deleting individual shots.

Each film-roll card is generated dynamically and connected to its corresponding actions.

## Sound Engine

The app does not rely on MP3 or WAV files for its interface sounds. Instead, sound effects are synthesized using the Web Audio API.

### Recording Beeps

Recording start and stop sounds use sine-wave oscillators with volume envelopes.

### Shutter Sound

The shutter effect combines short bursts of generated white noise with filtering to create a mechanical camera-like sound.

Because browsers restrict automatic audio playback, the sounds are triggered as part of user interactions such as clicks and key presses.

## Visual Details

### Film Grain

The film grain is generated without an image file. A small noise canvas is created using `createImageData()` and reused as a repeating texture.

The page also uses an SVG `feTurbulence` filter as a noise texture for the overall film-grain effect.

### REC Indicator

The recording indicator uses:

```css
animation: blink 1s steps(2, start) infinite;
```

Using `steps()` creates a sharp on/off blink instead of a smooth fade, matching the camcorder aesthetic.

### Capture Flash

The flash animation is restarted by removing and re-adding its CSS class. A forced layout read with `offsetWidth` ensures the browser treats the animation as a fresh transition.

### Polaroid Ejection

The print animation uses a spring-like cubic-bezier easing curve to create a small overshoot when the Polaroid slides into view.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Capture |
| `R` | Recording control |
| `S` | Shutter / capture |
| `P` | Power |
| `Esc` | Close lightbox |

Keyboard shortcuts are ignored when the lightbox is open where appropriate, preventing accidental actions while viewing a captured shot.

## Async UI Safety

The lightbox includes a stale-operation guard for asynchronous Polaroid composition.

If the user closes the lightbox or switches to another shot before composition finishes, the completed image is only applied if it still belongs to the currently displayed shot.

This prevents an older asynchronous operation from updating the wrong part of the UI.

## Browser Requirements

The app relies on browser APIs for camera, microphone, recording, canvas processing, and audio.

For camera access, run it through:

- `localhost` during development, or
- an HTTPS deployment in production.

Users must also grant the required camera and microphone permissions.

## Possible Future Improvements

Some ideas for extending the project:

- Add a B&W or other camera filter
- Add a sepia HUD effect
- Add a “Print All” option
- Add a photo countdown timer
- Expand the Polaroid customization options
- Add more capture effects

## Project Takeaways

This project demonstrates several useful browser concepts in one small application:

- Working with live `MediaStream` objects
- Capturing video frames with Canvas
- Recording media with `MediaRecorder`
- Managing Blobs and object URLs
- Building UI state with a simple state machine
- Creating visual effects with CSS
- Synthesizing sound with the Web Audio API
- Handling asynchronous UI operations safely
- Managing temporary media resources

The result is a fully browser-based camera experience built with native web APIs and no media-processing backend.
