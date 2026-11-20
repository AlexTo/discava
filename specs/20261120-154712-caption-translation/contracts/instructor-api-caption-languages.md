# Contract: instructor-api, caption languages and translated tracks

All procedures are on `courseProcedure` and call `requireCourseInstructor`: only an instructor of the course may use them. A write is refused on an archived course, module, lesson or item, as every other caption write is. Core-table errors map through the API's existing error handling (`InvalidRequestError` to `BAD_REQUEST`, `NotFoundError` to `NOT_FOUND`).

## `course.captionLanguages` (query, new)

Input: `{ courseId: string }`

Output:

```ts
{
  languages: string[];          // the course's caption languages, in order; [] when none
  supported: { tag: string; label: string; nativeLabel: string }[];  // CAPTION_LANGUAGES
  enabled: boolean;             // the stage's setting
  maxLanguages: number;         // min(9, the stage's maxLanguagesPerCourse)
}
```

## `course.updateCaptionLanguages` (mutation, new)

Input: `{ courseId: string, languages: string[] }`. Each entry must pass `isCaptionLanguage`; the schema refuses duplicates and more than 9.

Behaviour: reads the stage's settings, then calls `setCourseCaptionLanguages(coreTable, { courseId, languages, maxLanguages })`. An empty list removes the attribute.

Output: the same shape as `course.captionLanguages`.

Errors:

| Case | Error |
|------|-------|
| Not an instructor of the course | `FORBIDDEN` (from `requireCourseInstructor`, as today) |
| Unknown course | `NOT_FOUND` |
| Archived course | `PRECONDITION_FAILED`, "Restore the course before editing it" (the existing guard's message) |
| Unknown tag, duplicate, or more than `maxLanguages` | `BAD_REQUEST`, "Choose at most `<n>` caption languages" for the limit |
| Translation is off for the stage and `languages` is not empty | `PRECONDITION_FAILED`, "Caption translation is not available" |

It doesn't touch any video. The `caption-translation` stream feature sees the course change and asks each video for translation ([translation-handler.md](./translation-handler.md)).

## `course.retryCaptionTranslations` (mutation, new)

Input: `{ courseId: string }`. Output: `{ requested: number }`, the number of videos asked.

For every video of the course that has caption tracks, and the course's preview, calls `requestCaptionTranslation(coreTable, key)`: clears `captionTranslation` and sets `captionTranslationRequestedAt` to now. Refused with `PRECONDITION_FAILED` when translation is off or the course has no caption languages.

## `contentItem.retryCaptionTranslation` (mutation, new)

Input: the caption item ref (`courseId`, `moduleId`, `lessonId`, `contentItemId`). Output: the extended video URL output's `translations` (below).

Uses `requireReadyVideo`, then `requestCaptionTranslation` for the item. Same refusals as the course-wide one.

## `contentItem.createVideoUrl` and `coursePreview.createVideoUrl` (changed)

Each caption in the output already has `source`. It gains the third value, and the output gains `translations`:

```ts
captions: {
  trackId: string; language: string; label: string; isDefault: boolean;
  source: 'auto' | 'uploaded' | 'translated';
  url: string;
}[];
translations: {
  language: string;             // a course caption language
  label: string;                // English name
  nativeLabel: string;
  state: 'translated' | 'uploaded' | 'translating' | 'failed' | 'too-long'
       | 'no-room' | 'not-translated';
  reason?: 'no-captions' | 'language-mismatch' | 'disabled';   // with not-translated
}[];                            // [] when the course has no caption languages
```

`translations` is the reported status of [data-model.md](../data-model.md): `planCaptionTranslations` on the record's tracks with the course's `captionLanguages` and `language` and the stage's settings, combined with the record's `captionTranslation`. The procedure reads the course for this (one more `get`).

`CaptionTrackOutputSchema` (returned by `attachCaption` and `removeCaption`) gets the same `source` enum.

## `contentItem.attachCaption` (changed)

- Reads the course's `captionLanguages` and passes them to `applyCaptionChange`, so an upload at the 10-track limit evicts a translated track instead of failing (FR-014).
- After its conditional write succeeds, deletes the files of `replaced`, `evicted` and `staleTranslated` tracks (best effort, as it deletes `replaced` today).
- `BAD_REQUEST` "A video can have at most 10 caption tracks" remains for a full list with no translated track.

## `contentItem.removeCaption` (changed)

- `BAD_REQUEST`, "An auto-translated track can't be removed here. Upload your own captions for this language, or remove the language from the course's caption languages.", when the track's `source` is `translated` (FR-016).
- After its write, deletes the files of `staleTranslated` tracks too (removing the source track drops its translations, FR-020).

## Content item rows

`captionTrackCount` on a video row keeps counting every track, translated ones included.

## Tests the procedures ship with

- Authorisation: each new procedure refuses a non-instructor and an instructor of another course.
- `updateCaptionLanguages`: saves an ordered list; refuses a duplicate, an unknown tag, one more than the stage's limit, and any list when translation is off; an empty list clears; an archived course is refused.
- `attachCaption`: an upload replaces a translated track of its language; an upload at 10 tracks with a translated track succeeds and the evicted track's file is deleted; an upload at 10 with none translated is still refused; an upload that replaces the default deletes the stale translated tracks' files.
- `removeCaption`: refuses a translated track; removing the default drops translated tracks.
- `createVideoUrl`: each `translations` state, including `failed` only when the outcome names the current default track.
- Retry procedures: set the request marker, clear the outcome, and count the videos.
