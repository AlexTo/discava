# Contract: core-api output, the player and the instructor portal

## core-api: `contentItem.createVideoUrl` and the preview's video URL (changed)

Each entry of `captions` gains one field:

```ts
captions: {
  trackId: string; language: string; label: string; isDefault: boolean; url: string;
  machineTranslated: boolean;   // true when the stored track's source is 'translated'
}[];
```

Nothing else changes: the order is still the default first and the rest as added (`tracksForPlayback`), the URL is under the version's folder and covered by the same signed cookies, and the track's `source`, its S3 key and the caption status are still never returned. The schema comment "never … the track's source" becomes "never the track's source beyond whether it was machine-translated".

Access is unchanged: a caller who may not play the video gets no captions, translated or not (User Story 1, scenario 5). The anonymous preview procedure returns translated tracks under the same rules as its other tracks (scenario 6).

Tests: a translated track comes back with `machineTranslated: true` and after the default; an uploaded and an automatic track come back `false`; the existing access tests still pass unchanged.

## Player (`packages/common/shadcn/src/components/hls-video.tsx`, `video-controls.tsx`)

- `PlayerCaption` and `LoadedCaption` gain `machineTranslated?: boolean`.
- A helper `captionMenuLabel(caption)` returns `caption.label`, or `` `${caption.label} (auto-translated)` `` when `machineTranslated`. The suffix is the exported constant `AUTO_TRANSLATED_SUFFIX = '(auto-translated)'`.
- The label is used in three places: the captions menu item, the captions button's accessible name ("Captions: Español (auto-translated)"), and the `<track label>`.
- The notice for a track that failed to load names it the same way.
- No other behaviour changes. The remembered `captionLanguage` still selects a track by `language`, so a translated Spanish track is chosen for a student who last chose Spanish, whether that was translated or uploaded.

Component tests (`video-controls.test.tsx`, `hls-video.test.tsx`): the suffix appears on a translated track and not on others, in the menu and in the button's name; choosing a translated track saves its language; a remembered language selects the translated track on the next render.

## Instructor portal: caption languages card

`packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/course/course-caption-languages-form.tsx`, shown on the course page beside the catalogue form.

- Title "Caption languages". Help text: "Captions are translated automatically into the languages you choose. Your own uploaded captions always take precedence."
- One checkbox per `supported` language, labelled "`<label>` (`<nativeLabel>`)", for example "Spanish (Español)". Ticked ones are saved in the order they were ticked, after those already saved.
- A counter "`<n>` of `<maxLanguages>`". At the limit, unticked boxes are disabled.
- "Save" (text only) calls `course.updateCaptionLanguages`. Errors show in an `ErrorAlert`.
- Unticking a saved language shows, before saving, "Translated `<label>` captions will be removed from every video. Captions you uploaded stay."
- When `enabled` is false: the boxes are disabled and the card says "Caption translation isn't available on this site."
- A secondary button "Translate missing captions again" calls `course.retryCaptionTranslations` and reports "Asked `<n>` videos". Shown only when the course has caption languages.
- Read-only on an archived course, like the other cards.

Component tests with `renderWithInstructorApi`: loads and ticks saved languages; saving sends the ordered list; the limit disables boxes; the disabled state; the removal warning; an API error is shown; the retry button calls its procedure.

## Instructor portal: captions dialog (`video-captions-dialog.tsx`)

- The track badge shows "Automatic", "Uploaded" or "Auto-translated" (today it prints the raw `source`).
- A translated track has no "Remove" button. In its place, muted text: "From the course's caption languages".
- Under the track list, a "Translations" list with one row per entry of `translations` that has no track of its own:

| `state` | Row text |
|---------|----------|
| `translating` | "`<label>`: Translating…" |
| `failed` | "`<label>`: Translation failed" |
| `too-long` | "`<label>`: Captions are too long to translate" |
| `no-room` | "`<label>`: No room (10 tracks at most)" |
| `not-translated`, `no-captions` | "`<label>`: Needs captions first" |
| `not-translated`, `language-mismatch` | "`<label>`: The automatic captions aren't in the course's language. Upload captions in the video's language to translate them." |
| `not-translated`, `disabled` | "`<label>`: Translation isn't available on this site" |

- A "Translate again" button (text only) under the list when any row is `failed` or `translating`; it calls `contentItem.retryCaptionTranslation` and refreshes the dialog's query.
- While any row is `translating`, the dialog refetches its query every 5 seconds, and stops when none is.
- The dialog's intro line becomes: "A video can have up to 10 tracks, one per language, including auto-translated ones."

Component tests: each badge; no Remove on a translated track; each row text; the retry button; polling starts and stops.

## End-to-end (`packages/e2e`)

A new scenario file `src/scenarios/caption-translation.e2e.ts`, with helpers added to `src/helpers/captions.ts`, and a concurrency test added to `src/concurrency/caption-attach.e2e.ts`. Each makes its own users and uniquely named course, and takes `screenshot()` at each step a user sees.

1. An instructor chooses Spanish and French; a video already in the course gets both tracks; a student sees "Español (auto-translated)", picks it and reads `[es-ES] …`; the next video shows Spanish without picking.
2. An uploaded Spanish file replaces the translation and survives a source replacement; removing it brings the translation back.
3. Replacing the source track re-translates; unticking French removes French from every video.
4. A source file with `[[fail-translation:fr-FR]]` leaves the video playing with its source and Spanish tracks and shows "French: Translation failed". "Translate again" runs the translation again (the row goes to "Translating…" and back to failed, since the marker is still there). Replacing the source with a file without the marker produces the French track.
5. Concurrency: an upload for a language and a caption-language change that adds the same language are fired together; the track that remains is the upload.

The table invariants are checked after every test, as for every scenario.
