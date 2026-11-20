# Contract: the `caption-translation` stream feature

## Registration (`core-table/src/helpers/stream-features.ts`)

```ts
{
  name: 'caption-translation',
  filters: CAPTION_TRANSLATION_STREAM_FILTERS,
  handler: 'caption-translation',
  batch: { maxRecords: 5, windowSeconds: 5 },
  maxReceiveCount: 5,
  maxConcurrency: 2,
}
```

`CAPTION_TRANSLATION_STREAM_FILTERS` (in a new `helpers/caption-translation-stream.ts`) lists MODIFY of `contentItem`, `coursePreview` and `course`. The feature's entry in `MATCHERS`, `matchesCaptionTranslationStreamFilters(record)`, narrows them:

| Entity | Passes when, between `OldImage` and `NewImage` |
|--------|-----------------------------------------------|
| `contentItem`, `coursePreview` | the list of tracks whose `source` isn't `translated` differs (compare each track's `trackId`, `language` and `isDefault`), or `captionTranslationRequestedAt` differs |
| `course` | `captionLanguages` or `language` differs (the planner reads both: `language` decides `language-mismatch`) |

A record with either image missing doesn't pass. INSERT and REMOVE never pass: a new video has no tracks, and a removed one has nothing to translate.

## Handler (`packages/events/src/media/caption-translation.ts`)

Wrapped like the other feature handlers (`sqsToStreamRecords`, Powertools logger, tracer and metrics), registered in `router/handlers.ts`, with a Lambda construct `EventsCaptionTranslation` from the `ts#lambda-function` generator: 15-minute timeout.

For each distinct record key in the batch (a video named twice is handled once):

**A course record**: read the course. Query its curriculum for video content items and get its preview. For each that has caption tracks, `requestCaptionTranslation(key)`. Nothing is translated in this branch.

**A video record** (`translateVideoCaptions`, in `media/caption-translation-outcome.ts`):

1. Read the record and its course. Stop if the record is gone, isn't a ready video, or its course is gone.
2. `planCaptionTranslations(...)` with the course's `captionLanguages` and `language` and the stage's settings.
3. If `plan.remove` isn't empty: one conditional write taking them out (through `applyCaptionChange` removes), then delete their files.
4. If `plan.translate` is empty: clear a stale `captionTranslation` and stop.
5. Get the source track's file. Parse it. If its cue text is over `TRANSLATION_MAX_CHARACTERS` (300,000): record `too-long` for every language in `plan.translate`, stop, don't fail the message.
6. For each language in order, unless under two minutes of the run remain:
   - translate the cue texts ([Translate client](#translate-client));
   - build the WebVTT, check the cue count and timing lines equal the source's and `isWebVtt` passes;
   - put it at the version's captions key with `ContentType: text/vtt`;
   - read the record again, `applyCaptionChange` an `add` with `source: 'translated'`, `sourceTrackId`, `label: nativeLabel`, and write with `captionWriteCondition(rev, nonce)`. On a lost condition, read and try once more. A `dropped` result, or a second lost condition, deletes the file;
   - on success, add to the metrics and log the track.
7. Write `captionTranslation` when the set of failures changed. Then, if any language failed for a reason a retry can help (service error, throttling, out of time), throw so the message is retried.

Every write is conditioned on the record still playing the version (`nonce`) the run read, so a result for a replaced or deleted video is dropped and its file deleted.

### Duplicate and reordered delivery (required of every feature)

The file's header comment states it: the handler reads only the record's key from the change and works from the record and course as they are now. A duplicate finds every language already translated from the current source and does nothing. An older change handled after a newer one computes the same plan as the newer one did. The tests include both.

## Translate client (`packages/events/src/media/translate-client.ts`)

```ts
translateTexts(input: {
  texts: string[];              // one per cue, plain text, no line breaks
  sourceLanguage: string;       // caption tag, e.g. en-US
  targetLanguage: string;       // caption tag, e.g. es-ES
}): Promise<{ texts: string[]; characters: number; requests: number; fallbacks: number }>
```

- Maps caption tags to Translate codes with `TRANSLATE_LANGUAGE_CODES` (`en-US: 'en'`, `es-ES: 'es'`, `fr-FR: 'fr'`, `de-DE: 'de'`, `pt-BR: 'pt'`, `ja-JP: 'ja'`, `zh-CN: 'zh'`, `hi-IN: 'hi'`, `ar-SA: 'ar'`, `vi-VN: 'vi'`). A tag with no code throws `UnsupportedLanguageError` (not retried).
- Chunks `texts` joined by `\n` into requests of at most `TRANSLATE_CHUNK_MAX_BYTES` (5,000) UTF-8 bytes, runs up to four requests at once, and splits each answer on `\n`. A chunk whose answer has a different number of lines is sent again one text per request (`fallbacks` counts those chunks).
- Empty texts are not sent and come back empty.
- `characters` is the number of characters sent, which is what the service charges for.
- Under `LOCAL_DEV` it calls `translateLocally` (below) and never constructs the SDK client.
- Never sets `SourceLanguageCode: 'auto'`.

## Local stand-in (`packages/events/src/local/translator.ts`)

`translateLocally({ texts, sourceLanguage, targetLanguage })` returns each text as `[<targetLanguage>] <text>` and empty texts unchanged. It throws `UnsupportedLanguageError` (the client's own error for a language the service refuses, which the handler records and does not retry) when any text contains `[[fail-translation]]` or `[[fail-translation:<targetLanguage>]]`. So a deliberate local failure shows as "Translation failed" at once and leaves nothing in the failure queue. The retry path is driven locally with the runner's own switch, `POST /router/fail/caption-translation`.

## Metrics and logs

Powertools metrics, namespace `CaptionTranslation`, default dimension `Stage` = `process.env.STAGE_NAME` (the stack sets it; `local` under `LOCAL_DEV`), and dimension `TargetLanguage` on:

| Metric | Unit | Meaning |
|--------|------|---------|
| `TranslatedCharacters` | Count | characters sent for translation |
| `TranslatedTracks` | Count | translated tracks written |
| `TranslationFailures` | Count | languages that failed in a run |
| `ChunkFallbacks` | Count | chunks re-sent one cue at a time |

One `info` log line per track written: `courseId`, the record key, `language`, `characters`, `requests`, `fallbacks`.

## Infrastructure (`packages/infra/src/stacks/stream-router-stack.ts`)

`createCaptionTranslationLambda(coreTable, lessonMediaBucket)`, added to the `handlers` object under `'caption-translation'`:

- `grantAppConfig`, `coreTable.grantReadWriteData`;
- `lessonMediaBucket.grantRead`, `grantPut` and `grantDelete` on `courses/*/captions/*` only;
- a policy statement `translate:TranslateText` on `*`, with the checkov suppression and reason of research R-9;
- environment `STAGE_NAME`.

The stack receives the lesson media bucket as a prop from `application-stage.ts` (it lives in the Data stack, which this stack already depends on).

`RuntimeConfig` gets `captionTranslation.Settings = { enabled, maxLanguagesPerCourse }` from the stage's `captionTranslation` config. It is one object under one key because `resolveAppConfigValue` treats a falsy value as missing, and `enabled: false` must be readable.

## Tests the handler ships with

- Matcher: passes each case in the table above; doesn't pass a title edit, a `studentActivityCount` change, a write that only adds a translated track, a write of `captionTranslation`, an INSERT or a REMOVE.
- Handler, with the Translate client and S3 mocked: translates every planned language and writes the tracks; skips a language an upload holds; removes tracks of a language the course dropped; `too-long` records and doesn't throw; a service error for one language leaves the others written, records `failed`, then throws; a second run after the failure writes the missing track and clears the failure; a result for a replaced version is dropped and its file deleted; a lost condition is retried once; a course record touches each video with tracks and translates nothing, both for a change of `captionLanguages` and for a change of `language` alone.
- Duplicate delivery and reordered delivery.
- Translate client: chunk sizes by bytes (including multi-byte text), the fallback on a line-count mismatch, empty texts, an unknown tag, the language-code map covering every `CAPTION_LANGUAGES` tag, and the local stand-in's output and failure markers.
- Stack: the synthesised policy has `translate:TranslateText` and S3 access limited to the captions pattern, and no Comprehend, Transcribe or MediaConvert action.
