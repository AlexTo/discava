# Data Model: Machine-Translated Caption Tracks

No new entity and no new index. Three existing records gain attributes: `course`, `contentItem` and `coursePreview` (the last two through the shared `captionAttributes` in `entities/content-item.ts`). Discava hasn't launched, so shapes change outright and no old data is migrated (constitution VII).

## `course`

| Attribute | Type | Rules |
|-----------|------|-------|
| `captionLanguages` | list of string, optional | Caption language tags from `CAPTION_LANGUAGES` (`common-web-utils/caption-languages`), in the instructor's order. No duplicates. At most 9, and at most the stage's `maxLanguagesPerCourse` when it was saved. Absent when empty |

Written only by `setCourseCaptionLanguages(service, { courseId, languages, maxLanguages })` in `core-table/src/helpers/course-catalogue.ts`, which validates the list, patches the course and refreshes `courseUpdatedAt` on its instructors' records (the existing `refreshInstructorCourseUpdatedAt`). Throws `InvalidRequestError` for an unknown tag, a duplicate or too many, and `NotFoundError` for an unknown course.

A stage's limit that is lowered later doesn't shorten saved lists; the next save must fit.

## `contentItem` and `coursePreview` (`captionAttributes`)

| Attribute | Type | Rules |
|-----------|------|-------|
| `captionTracks[].source` | `'auto' \| 'uploaded' \| 'translated'` | `'translated'` is new |
| `captionTracks[].sourceTrackId` | string, optional | Present on a translated track and only there: the `trackId` of the track it was made from |
| `captionTranslation` | map, optional | `{ sourceTrackId: string, failures: { language: string, reason: 'failed' \| 'too-long' }[], updatedAt: string }`. Written only by the translation handler; cleared by "Translate again". Describes the source track named in it and is ignored once the default track is another |
| `captionTranslationRequestedAt` | string (ISO time), optional | Set to ask for the record's translations to be worked out again: by the handler for each video when a course's languages change, and by "Translate again". Its value is never read; a change to it is what the stream matcher passes |

Unchanged: `captionTracksRev` still counts every write to `captionTracks` and is the condition that serialises writers; `captionsStatus` and `captionsPendingSince` describe automatic captioning only and are never written by translation.

A translated track's other fields: `language` is a caption tag, `label` is that language's `nativeLabel`, `key` is under the version's captions folder like every track's (`.../<nonce>/captions/<trackId>.vtt`), `nonce` is the version's, `isDefault` is always `false`.

## Track rules (`core-table/src/helpers/caption-tracks.ts`)

`applyCaptionChange(current, change, { currentNonce, captionLanguages? })` stays the one place a new track list is computed. Added behaviour, with what it returns for the caller to clean up:

| Change | Result |
|--------|--------|
| add `translated`, a non-translated track holds the language | `dropped` (the list is unchanged) |
| add `translated`, its `sourceTrackId` isn't the version's default track | `dropped` |
| add `translated`, a translated track from the same source holds the language | `dropped` |
| add `translated`, the list is full | `dropped` |
| add `translated`, otherwise | appended, or replaces a translated track of the language from an older source (`replaced`) |
| add `auto` or `uploaded`, a translated track holds the language | replaces it (`replaced`) |
| add `uploaded`, new language, list full, at least one translated track | evicts one translated track (`evicted`): the one whose language is last in `captionLanguages`, or the last added when none is listed; then appended |
| add `uploaded`, new language, list full, no translated track | `TOO_MANY_TRACKS`, as today |
| any add or remove after which the version's default track is a different track | every translated track of the version is taken out (`staleTranslated`), since they were made from the old one |
| remove the default track | the default passes to the oldest remaining track that isn't translated; if there is none, the translated tracks go too and the list is empty |
| remove a `translated` track | allowed here (the handler uses it); instructor-api refuses it before calling (FR-016) |

`CaptionChangeResult` gains `evicted?: CaptionTrack` and `staleTranslated?: CaptionTrack[]` so callers can delete those files, as they do for `replaced` and `removed`.

`planCaptionTranslations(tracks, { nonce, captionLanguages, courseLanguage, settings })` is pure and returns:

```text
{
  sourceTrack?: CaptionTrack            // the version's default track
  translate: string[]                   // languages to make now, in the course's order
  remove: CaptionTrack[]                // translated tracks no longer wanted
  languages: { language, state, reason? }[]   // one per course language
}
```

`state` per course language, decided in this order:

| State | When |
|-------|------|
| `not-translated` / `disabled` | the stage has translation off |
| `not-translated` / `no-captions` | the version has no default track |
| `uploaded` | a track that isn't translated holds the language (this includes the source track's own language) |
| `not-translated` / `language-mismatch` | the source track is `auto` and the course's `language` is set and differs from the track's base language (research R-12) |
| `translated` | a translated track from the current source holds the language |
| `no-room` | no free place is left for it under the 10-track limit, taking languages in the course's order |
| `pending` | otherwise: it is in `translate` |

`remove` holds every translated track whose language isn't a course language any more, or whose state is `not-translated` or `no-room`.

## Reported status (instructor-api)

For each course language of a video, the instructor sees the planner's state combined with the stored outcome:

| Reported | From |
|----------|------|
| `translated`, `uploaded`, `no-room`, `not-translated` (+ reason) | the planner |
| `failed` | planner says `pending`, and `captionTranslation.sourceTrackId` is the current default track and lists the language with reason `failed` |
| `too-long` | the same, with reason `too-long` |
| `translating` | planner says `pending` and no failure is recorded for the current source |

Nothing here is stored beyond `captionTranslation`; it is worked out on each read, so it can't go stale.

## Invariants (`core-table/src/helpers/invariants/media.ts`)

Extended (constitution IV, impact check):

- **`caption-tracks-valid`** (existing). `captionTrackProblems` gains, for lesson videos and previews alike:
  - a translated track is the default;
  - a translated track has no `sourceTrackId`, or it isn't the `trackId` of the version's default track;
  - a track that isn't translated has a `sourceTrackId`;
  - a translated track's language equals the default track's.

  The preview branch's comment "a coursePreview's captions are automatic only" becomes "automatic or translated"; its check (ready captions imply a track of the played version) is unchanged and still holds, because a translated track can't exist without the default it was made from.
- **`video-transcode-state`** (existing): the check that caption attributes appear only on video items also covers `captionTranslation` and `captionTranslationRequestedAt`.

Added:

- **`course-caption-languages-valid`**: a course's `captionLanguages`, when present, is non-empty, has no duplicate, at most 9 entries, and only tags from `CAPTION_LANGUAGES`.

Deliberately not an invariant: "a translated track exists only for a language its course lists". The two records are brought in line by the queue, a moment apart, so a snapshot taken between them would fail a correct system. The handler's tests cover it instead.

Unchanged and still covering these records: `instructor-course-updated-at` (kept by `setCourseCaptionLanguages`), the one-per-language, at-most-10, exactly-one-default, version and key-folder parts of `caption-tracks-valid`.

## Access patterns

| # | Pattern | Served by |
|---|---------|-----------|
| CT1 | A course's caption languages | `course.get({ courseId })` |
| CT2 | A video's tracks and translation outcome | `contentItem.get(key)` or `coursePreview.get({ courseId })` |
| CT3 | Every video of a course, to ask each for translation | one query of the course's curriculum on the course's partition (content items of type `video`), plus `coursePreview.get` |
| CT4 | Set a course's caption languages | `course.patch`, then the instructors' `courseUpdatedAt` refresh, as the catalogue writer does |
| CT5 | Change a video's tracks | `patch` with `captionWriteCondition(rev, nonce)`, as today |

No scan and no new index. CT3 runs in the handler, outside any user request.

## Stream features

- New registration `caption-translation` in `STREAM_FEATURES`, with its own matcher in `MATCHERS` (research R-6). It reads `contentItem`, `coursePreview` and `course`.
- Existing registrations are unchanged. `search-indexing` and `analytics-update` receive `course` changes already and derive their output from the course's own fields, which don't include `captionLanguages`. `progress-recalculation` reacts to curriculum inserts and removals, not to caption attributes.

## Files (lesson media bucket)

| Object | Key | Written by | Removed by |
|--------|-----|-----------|------------|
| A translated track | `<video folder>/<nonce>/captions/<trackId>.vtt` | the translation handler | the handler (unwanted, dropped or replaced tracks), instructor-api (a translated track its upload replaced or evicted, or made stale), and the version's retirement, which deletes the whole `<nonce>/` folder as today |

No scratch prefix is used: the handler builds the file in memory and puts it once.

## Stage config and runtime config

| Where | Key | Type |
|-------|-----|------|
| `common-infra-config` `stages.types.ts` | `captionTranslation.enabled` | boolean, default `true` |
| | `captionTranslation.maxLanguagesPerCourse` | integer 0 to 9, default `9` |
| Runtime config, namespace `captionTranslation` | `Settings` | `{ enabled, maxLanguagesPerCourse }`, one object so that `enabled: false` is readable (`resolveAppConfigValue` treats a falsy value as missing) |
