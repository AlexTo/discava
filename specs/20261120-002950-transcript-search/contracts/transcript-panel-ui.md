# Contract: the transcript panel (`HlsVideo`, `VideoControls`, `TranscriptPanel`)

In `packages/common/shadcn/src/components/`. Only the student portal's lesson player turns it on.

## `HlsVideo` props (added)

| Prop | Type | Effect |
|------|------|--------|
| `transcript` | `boolean`, default `false` | Offers the "Transcript" control and renders the panel. Without it nothing changes for the instructor preview or the course preview |
| `startAt` | `number` (seconds), optional | Seeks there once the video loads, stays paused, shows "Starting at m:ss" in place of "Resumed at". Takes the place of `resumeAt` for this mount, clamps to the duration like `resumeAt`, and is the position reporter's initial position, so the seek saves nothing |

## Data

- `useCaptionFiles` parses each fetched file once with `parseWebVtt` and gives `LoadedCaption.cues`.
- The panel shows the track `VideoControls` would show: the chosen track, else the remembered `captionLanguage`, else the default, else the first (today's `lastTrack`), whether captions are on or off.
- The current line is `activeCueIndex(cues, video.currentTime)`: the last cue whose start is at or before the time, or none before the first cue. It is recomputed on `timeupdate` and `seeked`.

## States

| State | "Transcript" control | Panel |
|-------|----------------------|-------|
| `transcript` not set | Absent | Absent |
| No track exists, or the files are still loading | Absent | Absent |
| Tracks loaded, panel closed (default) | Shown, `aria-expanded="false"` | Not rendered |
| Panel open | Shown, `aria-expanded="true"` | Lists every cue of the track |
| No track loaded and at least one failed (the player's `captionNotice` is set) | Shown | "This transcript couldn't be loaded." |
| Some tracks loaded, the learner's language among the failed ones | Shown | The track `VideoControls` falls back to, as the captions menu does |
| The track has no cues after parsing | Shown | "This transcript is empty." |
| Fullscreen | Shown | Hidden while fullscreen |

Open or closed is `transcriptOpen` in the saved player preferences.

## Structure

```text
<div data-slot="hls-video-layout">          grid: one column; two from lg when the panel is open
  <VideoControls …>                          the player, unchanged, plus the "Transcript" button
  <section aria-label="Transcript (English)" id=…>   outside the player's shortcut container
    <h3>Transcript</h3> <span>English</span>
    <button>Jump to current line</button>    only while following is paused
    <ol>
      <li><button aria-current="true" tabindex="0">
            <span aria-hidden="true">12:40</span>
            <span class="sr-only">12 minutes 40 seconds</span>
            the line's text
          </button></li>
      …
    </ol>
  </section>
</div>
```

- The "Transcript" button is a text button in the control bar, with `aria-expanded` and `aria-controls`. No arrow icon.
- Line text is rendered as text nodes. Nothing from a caption file is set as HTML.
- From `lg`, the panel is beside the player and as tall as it. Below `lg`, it is under the player, `max-height: min(20rem, 50vh)`. It scrolls inside itself (`overflow-y: auto`), and long words wrap. No horizontal scrolling at 375 px.

## Pointer and keyboard

| Input | Effect |
|-------|--------|
| Click or tap a line | Seek to its start and play. Following resumes |
| Tab into the list | Focus lands on the current line (or the first, before any cue). One more Tab leaves the list |
| Down, Up | Focus the next, previous line |
| Home, End | Focus the first, last line |
| Enter, Space on a line | As a click. Focus stays on the line |
| Any key in the panel | Never reaches the player's shortcuts (the panel is outside `VideoControls`' container) |

## Following playback

- While following, the panel sets its own `scrollTop` so the current line is in view, centred when it has to move. It never calls `scrollIntoView` and never moves focus.
- `wheel`, `touchmove`, a scrollbar drag, or focus moving inside the list pauses following and shows "Jump to current line".
- "Jump to current line", or choosing a line, resumes following.
- With `prefers-reduced-motion: reduce`, scrolling isn't animated.
- There is no live region. The current line is marked with `aria-current="true"` and a visible style that doesn't rely on colour alone (a left border and a heavier weight).

## Tests (jsdom)

`transcript-panel.test.tsx`, `hls-video.test.tsx`, `video-controls.test.tsx`:

- the control is absent without `transcript`, and without tracks;
- with every caption file failing, the control is shown and the panel says it couldn't be loaded;
- opening lists every cue with its time, and saves `transcriptOpen`;
- a saved `transcriptOpen: true` opens it on mount;
- `timeupdate` moves `aria-current`;
- clicking a line sets `currentTime` and calls `play()`;
- choosing another caption track changes the lines and the region's label;
- captions off still shows the remembered or default track;
- Down, Up, Home, End move focus, and exactly one line has `tabIndex=0`;
- an arrow key in the panel doesn't change `volume` or `currentTime`;
- a `wheel` event shows "Jump to current line", and choosing it hides it;
- a caption file with `<v Ana>`, `<i>` and `&amp;` shows plain text;
- `startAt` seeks, stays paused, shows "Starting at", and reports no position.
