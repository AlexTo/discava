# Contract: shared player UI

Component: `HlsVideo` in `packages/common/shadcn/src/components/hls-video.tsx` (the control bar in `video-controls.tsx`), used by the student portal (`learn/$courseId/-components/content-item.tsx`) and the instructor portal's video preview. Pure logic from `@discava/common-web-utils/video-player`.

## Props (additions)

`captions` (the API's list), `resumeAt` (seconds, default 0), `onPositionChange({ positionSeconds, durationSeconds })` (called by the player at most every 10 s while playing and on pause, seek end, `pagehide` and `visibilitychange` to hidden; absent in the preview, so nothing is saved there), `withCredentials` (existing; also governs caption fetches).

## Controls

Play/pause; seek bar (keyboard operable slider, shows elapsed and total); volume slider and mute; speed menu (0.5, 0.75, 1, 1.25, 1.5, 1.75, 2); captions menu (Off, then each track by label, default marked; absent when there are none); fullscreen (hidden when unsupported). Every control has an accessible name and exposes its state (pressed, current value). The bar shows while paused, on focus within, and for 3 seconds after pointer or key activity while playing; it respects `prefers-reduced-motion`. Buttons carry text labels or non-arrow icons with accessible names (no arrow icons).

## Keyboard (when the player container has focus; ignored for inputs and with Ctrl, Alt or Meta)

| Key | Action |
|-----|--------|
| Space, K | Play or pause |
| J, L | Back, forward 10 s |
| Left, Right | Back, forward 5 s |
| Up, Down | Volume up, down 5% |
| M | Mute |
| C | Captions on or off (last chosen track) |
| F | Fullscreen |
| `<`, `>` | Previous, next speed |
| 0 to 9 | Jump to 0% to 90% |

## States

| State | Behavior |
|-------|----------|
| Loading access | Existing spinner |
| Pending or failed video | Existing alerts |
| Ready, no saved position | Starts at 0:00, paused |
| Ready, `resumeAt` greater than 0 | Seeks to `resumeAt` (the saved position already lags by at most the save interval), stays paused, shows "Resumed at m:ss" with a "Start over" button, dismissed after 8 seconds or on play |
| Captions available | Control present; the remembered on/off choice and last track apply |
| No captions | No control (video plays normally) |
| A track fails to load | That track is skipped and a one-line, non-blocking notice appears in the menu; the video is unaffected |
| Storage unavailable | Defaults, silently |
| Access cookies expired mid-session | The page refetches access (existing query) and playback continues at the current position |

## Preferences

Stored under one `localStorage` key per portal origin: `{ speed, volume, muted, captionsOn, captionLanguage }`, read and written in try/catch, validated on read (out-of-range values are discarded to defaults).

## Component tests (`video-controls.test.tsx`, `hls-video.test.tsx`)

Media element stubbed. Cover: every shortcut; shortcuts ignored from an input; speed selection updates the element and storage; preference restore on mount; storage throwing is harmless; caption toggle adds and removes a track and persists the choice; a missing-captions video shows no control; resume notice, Start over and no autoplay; position callback throttling, and on pause and `pagehide`; the preview (no callback) never reports; accessible names and states. `video-player.test.ts` covers the pure functions.
