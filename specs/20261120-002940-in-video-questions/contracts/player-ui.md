# Contract: questions in the shared player

Three pieces (research R-10): pure logic in `@discava/common-web-utils/video-questions`, generic cue support in `common-shadcn`'s `HlsVideo` and `VideoControls`, and a question card plus controller in `common-shadcn`. A video given no cues renders and behaves exactly as today.

## `@discava/common-web-utils/video-questions` (new module)

```ts
export interface VideoQuestion extends QuizQuestion {   // from ./quiz
  atSeconds: number | null;
  contentHash: string;
}
export interface VideoAnswer {
  optionIds: string[];
  correct: boolean;
  correctOptionIds: string[];
  explanation?: string;
}
export type CueState = 'unanswered' | 'answered';
export interface PlayerCue {
  id: string;                 // the questionId
  atSeconds: number | null;   // null: at the end
  state: CueState;
  label: string;              // "Question at 1:30, not answered"
}

/** Cues in asking order: by time, then list order, then the end ones. */
export const toCues: (questions: VideoQuestion[], answers: Record<string, VideoAnswer>) => PlayerCue[];
/** Where a cue sits on a video of this length: null (the end) when it has no time or its time is at or past the duration. */
export const cueTime: (cue: PlayerCue, durationSeconds: number) => number | null;
/** The timed cues playback passed going from `previous` to `current`, in order. Empty when it moved backwards or by more than MAX_PLAYBACK_STEP_SECONDS (a seek the events missed). */
export const cuesReached: (cues: PlayerCue[], previous: number, current: number, durationSeconds: number) => PlayerCue[];
/** The cues to ask when the video ends: end cues, and timed ones at or past the duration. */
export const cuesAtEnd: (cues: PlayerCue[], durationSeconds: number) => PlayerCue[];
/** The position to save while a cue is open: one second before it, never below 0. */
export const positionBeforeCue: (cue: PlayerCue, currentTime: number, durationSeconds: number) => number;
/** All-or-nothing, as core-api grades. */
export const isCorrectAnswer: (optionIds: string[], correctOptionIds: string[]) => boolean;
export const MAX_PLAYBACK_STEP_SECONDS = 2;
```

## `HlsVideo` and `VideoControls`: new optional props

| Prop | Type | Meaning |
|---|---|---|
| `cues` | `PlayerCue[]` | Markers to show, and the moments to report. Absent or empty: nothing changes |
| `onCue` | `(cueIds: string[], reason: 'reached' \| 'chosen' \| 'ended') => void` | Playback reached unanswered cues (`reached`, all those at that moment), the viewer chose a marker (`chosen`, one id), or the video ended with cues to ask (`ended`) |
| `overlay` | `ReactNode` | When set, shown over the video inside the player's container. The player pauses and stays paused while it is set |
| `onOverlayDismiss` | `() => void` | The viewer pressed Escape while the overlay was open |
| `onTimeChange` | `(seconds: number) => void` | The current time, on every time update. The editor uses it to offer "Add a question here" |

### Reaching a cue

- A cue is **reached** when the video is playing, isn't seeking, and two consecutive time updates straddle its time (`cuesReached`). Only cues whose `state` is `unanswered` and which the caller hasn't told the player to leave alone (it passes only those) are reported.
- A seek, by dragging the bar, a shortcut (J, L, arrows, 0 to 9) or resuming at a saved position, reaches nothing: between the `seeking` and `seeked` events, and for the update that follows, no cue is reported.
- At `ended`, the player reports `cuesAtEnd` that are unanswered, with reason `ended`.
- A cue at 0 is reached by the first time update after play starts.

### Markers

- One marker per cue on the seek bar, at `cueTime / duration` of its width; end cues share one marker at the right edge.
- Each is a `button` in the tab order after the seek slider, with `aria-label` from the cue's `label`. Activating it seeks to the cue's time (the end marker to the last second), pauses, and calls `onCue([id], 'chosen')`.
- An answered marker shows a tick and an unanswered one a dot, so the state doesn't depend on colour. Markers are at least 24 by 24 CSS pixels to hit, though they may look smaller.
- Markers render only once the duration is known.

### While `overlay` is set

- The video is paused. If it was playing when the overlay appeared, it plays again when the overlay is cleared, unless the video has ended.
- The overlay is a `section` with `role="group"` and an accessible name, placed inside the container that goes fullscreen, above the video and the control bar. Fullscreen is kept.
- If the video is in picture-in-picture when a cue is reached, the player leaves picture-in-picture first.
- The control bar is `inert`, and the container's keyboard shortcuts do nothing. Escape calls `onOverlayDismiss`.
- Focus moves to the first element in the overlay marked `data-autofocus`. When the overlay is cleared, focus returns to the Play button.
- The position reported through `onPositionChange` while the overlay is open for a reached cue is `positionBeforeCue`, so a viewer who leaves comes back just before the question.
- With `prefers-reduced-motion`, the overlay appears and goes without a transition.
- When the question is taller than the video, the overlay grows below the video's frame and the page scrolls. At 375 px wide nothing scrolls sideways.

## `VideoQuestionCard` (`common-shadcn/src/components/video-question-card.tsx`)

Presentational. Props: `question`, `position` (`{ number, total }`, for an end check), `answer` (a `VideoAnswer` or undefined), `pending`, `error`, `updated` (show "This question was updated"), and `onSubmit(optionIds)`, `onSkip()`, `onContinue()`, `onTryAgain()`.

| State | Shows | Buttons |
|---|---|---|
| Unanswered | A heading ("Question at 1:30", or "Question 1 of 2" in an end check) with `data-autofocus` and `tabIndex={-1}`, the prompt (`RichTextView`), "Select all that apply" for multiple choice, the options as radios or checkboxes in a `fieldset` | **Submit answer** (disabled until an option is chosen), **Skip** |
| Submitting | The same, options disabled | **Submit answer** shows a spinner and is disabled; **Skip** stays enabled |
| Failed to save | The same with the learner's choice kept and an inline error | **Try again** (resubmits), **Skip** |
| Answered | A verdict with an icon and the words "Correct" or "Not quite", each option marked as chosen and as correct, the explanation when there is one. The verdict is in a `role="status"` region so it is announced | **Continue**, **Try again** |
| Practising (after Try again) | The unanswered layout, with a note "Practice: this answer isn't recorded" | **Check answer**, **Close** |

Buttons carry text only, with no arrow icons.

## `useVideoQuestions` (`common-shadcn/src/hooks/use-video-questions.ts`)

Holds what is open and in which state, and turns `onCue` calls into the `overlay`. It is given the data and one function, so both portals share it:

```ts
useVideoQuestions({
  questions: VideoQuestion[],
  answers: Record<string, VideoAnswer>,
  // Records an answer and resolves with the result, or rejects with
  // { kind: 'updated' | 'removed' | 'failed' }.
  submit: (question: VideoQuestion, optionIds: string[]) => Promise<VideoAnswer>,
  onChanged?: () => void,     // refetch after 'updated' or 'removed'
}): { cues: PlayerCue[]; onCue; overlay: ReactNode; onOverlayDismiss }
```

- Several cues reached together are asked one after another before the overlay clears.
- A skipped cue is remembered for the life of the component and left out of the cues passed for `reached`, so it isn't asked again on this visit. Its marker stays and still opens it.
- `updated`: the card stays open, `onChanged` refetches, and the refreshed question is shown with the "updated" note. `removed`: the overlay clears and playback resumes.
- An end check asks its cues in order and then shows a summary card: "2 of 3 correct" over the end questions answered so far, with **Close**.
- Try again is graded with `isCorrectAnswer` against the `VideoAnswer` already held, and calls nothing.

## Student portal (`routes/learn/$courseId/-components/`)

`VideoPlayer` in `content-item.tsx` reads `questionCount` from `videoUrl`. Above 0 it renders a `video-questions.tsx` wrapper that queries `videoQuestion.view`, calls `videoQuestion.answer` in `submit` (mapping `CONFLICT` to `updated`, the question's `NOT_FOUND` to `removed`), and updates the cached view with each recorded answer. While the view is loading or has failed, the video plays without cues. At 0 nothing new is rendered or requested.

## Component tests

`video-questions.test.ts` (web-utils), `video-controls.test.tsx` and `hls-video.test.tsx` (new cases; every existing case passes unchanged), `video-question-card.test.tsx`, `use-video-questions.test.tsx`, and the student portal's `-video-questions.test.tsx` with `renderWithCoreApi`. Elements are found by role and name.
