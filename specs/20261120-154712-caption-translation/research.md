# Research: Machine-Translated Caption Tracks

Facts about Amazon Translate below were read from AWS documentation on 2026-11-20. Each is marked **verified** (with the page it came from) or **unverified**. Every unverified fact has a **(human)** task in [tasks.md](./tasks.md) to confirm it before production is turned on. The AWS Pricing API could not be queried in this run (no credentials), so the one price quoted comes from the public pricing page and must be confirmed for the stage's region.

## R-1: Amazon Translate, and which of its APIs

**Decision**: Amazon Translate, through the real-time `TranslateText` operation, called from a Lambda. One call carries a chunk of a track's captions for one target language.

**Rationale**:
- The constitution allows only managed AWS services (principle I), and the issue names Amazon Translate.
- `TranslateText` is synchronous, so a track is translated and written in one Lambda run. There is no job to track, no completion event to route and no service role for the service to read a bucket.
- All ten languages a caption can be uploaded in are in Translate's supported list, and any of them can be the source: `en`, `es`, `fr`, `de`, `pt`, `ja`, `zh`, `hi`, `ar`, `vi` (**verified**: "Supported languages and language codes", `docs.aws.amazon.com/translate/latest/dg/what-is-languages.html`).
- Cost is the same for every API that fits: it is charged per character translated (R-10), not per request.

**Alternatives considered**:
- **Batch jobs (`StartTextTranslationJob`)**. One job can target up to 10 languages and reads and writes S3 itself. Rejected: it accepts text, HTML, Word, Excel, PowerPoint and XLIFF files but not WebVTT, so the cue text would still have to be taken out and put back; at most 10 jobs run at once per account (**verified**: "Guidelines and quotas", `.../what-is-limits.html`), which a course of 100 videos would queue behind; it needs a service role with read and write access to the lesson media bucket; and its result arrives by a separate event, so a second handler, a second local stand-in and job bookkeeping on the video record would be needed. For caption-sized text (tens of kilobytes) none of that buys anything.
- **Real-time document translation (`TranslateDocument`)** with the captions wrapped in HTML, which would keep one element per caption. Rejected: it translates only from English or into English (**verified**: same languages page, "Real-time document translation – Supports translations from English to any supported language, and from any supported language to English"). A Spanish-language course could not get French captions. It also has no free tier and a 100 KB document limit.
- **A foundation model on Amazon Bedrock**. It could translate with the whole transcript as context and would likely read more smoothly. Rejected for the first version: output isn't guaranteed to keep one line per caption, cost per character is harder to predict, and the issue asks for Translate. It is the follow-up if reviewers find caption-by-caption quality too low (T050).
- **Translating in the browser, or leaving it to browser extensions**. Not a track the platform stores, labels or can let an instructor override.

## R-2: Keeping cue timings

**Decision**: Parse the source WebVTT into cues. Translate only each cue's words. Write a new WebVTT with the source's cue identifiers and timing lines copied byte for byte, in the same order, and the translated words under them.

- A new pure module, `common-server-utils/webvtt` (`parseWebVtt`, `serialiseWebVtt`, `cueText`), shared by the handler and its tests. It sits beside `isWebVtt` in spirit, and transcript search (#590) is likely to want the same parser, which is why it isn't private to `packages/events`.
- A cue's words are made plain before translation: cue tags (`<v Name>`, `<i>`, `<c.class>`, inline timestamps) are removed, the entities `&amp;`, `&lt;`, `&gt;`, `&nbsp;` are decoded, and a cue's lines are joined with a space. After translation the text is escaped again (`&`, `<`, `>`), so no translated text can form a tag or the `-->` arrow. This keeps FR-008 and the player's plain-text rule.
- `NOTE`, `STYLE` and `REGION` blocks are not copied. Cue settings on the timing line (position, alignment) are kept because the timing line is copied whole.
- A cue with no words stays, with no words.
- The handler checks before writing that the output has the same number of cues as the input and that every timing line is identical, and treats a mismatch as a failure for that language. `isWebVtt` is run on the output too.

**Rationale**: Timings are never sent to the service, so nothing it does can move them (FR-006, SC-002). The check before writing turns a parser bug into a visible failure, not a wrong track.

**Known limit**: each cue is translated on its own. A sentence spread over three cues is translated as three fragments, which reads less smoothly than a sentence-level translation and can put a word in the wrong cue's language order. Translating whole sentences and then dividing the result back across the original timings needs word alignment, which Translate doesn't return. This is the trade the spec's Assumptions state. T050 has a person judge the result on real lectures.

**Alternatives considered**:
- Sending the whole file as text and trusting the service to leave timing lines alone. Timings would then depend on a translation model not touching digits and arrows.
- Merging cues into sentences before translating and re-splitting by character proportion. Smoother text, but captions would show words before or after they are spoken, and the cue count would no longer be provably equal.

## R-3: Fitting cues into requests

**Decision**: Send cue texts joined by a line feed, in chunks of at most 5,000 bytes of UTF-8, and split the answer on line feeds. If the answer doesn't have exactly as many lines as cues were sent, translate that chunk again one cue per request. Up to four requests run at once per language.

**Rationale**:
- A one-hour lecture is roughly 800 to 1,200 cues. One request per cue would be about 10,000 requests for nine languages; chunking makes it about 100.
- The fallback makes the design correct whether or not the service keeps line breaks one for one. That it does is **unverified**: the documentation doesn't promise it. The handler counts fallbacks in a metric (`ChunkFallbacks`), and T049 checks the rate on the development stage. If it is high, the chunking is dropped for one cue per request, with no change to data or contracts.
- The request size limit is documented two ways: "Maximum input text 10,000 bytes" in the quotas page (**verified**, `.../what-is-limits.html`), and "5,000 bytes per API call" in the product FAQ (`aws.amazon.com/translate/faqs/`). Which is current is **unverified**, so the constant (`TRANSLATE_CHUNK_MAX_BYTES`) uses the smaller one. A single cue over the limit (never seen in practice) is a failure for that language.
- The request rate the account is allowed is **unverified** (it is an adjustable quota not listed on the quotas page). Four at once per language, two handler runs at once (R-6) and the SDK's standard retry with backoff keep the rate low. A throttling error that survives the retries fails the language for this run and the message is retried (R-8).

**Alternatives considered**: a separator token between cues (more likely to be translated or dropped than a line break); one cue per request from the start (simplest, kept as the fallback).

## R-4: Where the course's caption languages live

**Decision**: A new attribute on the `course` record, `captionLanguages`: an ordered list of caption language tags (`es-ES`, `fr-FR`…), no duplicates, at most 9, absent when empty. Its only writer is a new core-table function `setCourseCaptionLanguages` in `helpers/course-catalogue.ts`, called by a new instructor-api procedure `course.updateCaptionLanguages`.

- The tags are the existing `CAPTION_LANGUAGES` of `common-web-utils/caption-languages` (the list uploads already use), so a translated track and an uploaded track for the same language collide on the same `language` value, which is what the "one per language" rule and upload precedence rest on. Each entry gains `nativeLabel` ("Español") for the menu label (FR-010) and the picker (FR-003).
- The mapping from a caption tag to a Translate code (`es-ES` to `es`, `pt-BR` to `pt`, `zh-CN` to `zh`) is server-side, in the events package beside the Translate client.
- Nine is the 10-track limit minus the source track. A stage can set a lower number (R-9).
- The list's order is the priority when a video has less room (FR-014 and the edge case "no room").

**Rationale**: The course record is read by every path that needs the list (the instructor's settings page, the translation handler, the upload procedure), by its key. `setCourseCaptionLanguages` sits beside `courseCatalogueWrites` because every writer of a course must refresh `courseUpdatedAt` on its instructors' records (the `instructor-course-updated-at` invariant), and that file already has the function that does it.

**Alternatives considered**:
- Reusing the catalogue's `language` field or adding the list to `CourseCatalogue`. The catalogue fields are replaced as a whole by one form ("an omitted field is removed"), so a caption-language save and a catalogue save would overwrite each other.
- A per-video list. More flexible, but the issue asks for a per-course choice, and a per-video choice would have to be made 100 times.
- A separate entity. Nothing else belongs to it, and it would add a read to every path.

**Not a catalogue field**: the search index and public landing page don't read `captionLanguages`. Showing "captions in…" on the landing page or filtering by it is out of scope (spec, Assumptions). The `search-indexing` feature receives every course change and re-indexes an identical document, as it does for other non-catalogue fields; no change to its registration is needed.

## R-5: Telling a translated track apart, and why an upload always wins

**Decision**: `CaptionTrack.source` gains a third value, `'translated'`, and a translated track carries `sourceTrackId`, the `trackId` of the track it was made from. All the rules live in `applyCaptionChange` and a new planner beside it in core-table's `helpers/caption-tracks.ts`, which every writer already goes through:

| Rule | Where |
|------|-------|
| A `translated` add is dropped when a track that isn't translated holds the language (as an `auto` add is dropped today for an upload) | `applyCaptionChange` |
| A `translated` add is dropped unless its `sourceTrackId` is the version's current default track | `applyCaptionChange` |
| An `auto` or `uploaded` add replaces a `translated` track in its language | `applyCaptionChange` |
| An `uploaded` add at the 10-track limit evicts one `translated` track: the one whose language is last in the course's list, or the last added when the course no longer lists it | `applyCaptionChange`, given the course's list |
| A change that gives the version a different default track (replace, remove) drops every `translated` track in the same write | `applyCaptionChange` |
| A translated track is never the default | `applyCaptionChange`; a removed default passes to the oldest track that isn't translated |
| Which languages to translate, which translated tracks to remove, and why a language is skipped | `planCaptionTranslations` (pure) |

**Why the upload wins by construction**: the handler never writes a track list of its own. It asks `applyCaptionChange` for the new list from the list it just read, and writes it with the existing revision condition (`captionWriteCondition`). If an instructor's upload landed first, the handler's write fails its condition, it reads again, and `applyCaptionChange` then drops the translated add. If the handler landed first, the upload replaces the translated track. Either order ends with the upload (FR-012, SC-003). This is the same mechanism that already stops a late Transcribe result overwriting an upload.

**Why stale tracks are dropped at once**: replacing the source track makes every translation of the old one wrong. Dropping them in the same write gives a rule a snapshot can check: every translated track's `sourceTrackId` is the default track's `trackId`. Students lose the translated languages for the minute or so until they are made again, and the player falls back to the default track meanwhile. Keeping stale tracks until their replacements arrive would be smoother but would leave a wrong track in place indefinitely when the re-translation fails.

**Alternatives considered**: a content hash of the source file on each translated track (needs the file read to check staleness; the track id already changes whenever the source does); a separate `translatedCaptionTracks` list (two lists to keep under one 10-track limit and one-per-language rule, and the player, the APIs and the invariants would each have to merge them).

## R-6: What starts a translation, and where it runs

**Decision**: A new feature of the core table's stream router, `caption-translation`, with its own queue, failure queue and alarm, and a handler `packages/events/src/media/caption-translation.ts`.

The feature's matcher (`helpers/caption-translation-stream.ts` in core-table, registered in `STREAM_FEATURES` and `MATCHERS`) passes a record only when a translation input changed:

| Record | Passes when |
|--------|-------------|
| `contentItem` or `coursePreview` MODIFY | the tracks that aren't translated differ between the old and new image (ids, languages or which is the default), or `captionTranslationRequestedAt` differs |
| `course` MODIFY | `captionLanguages` or `language` differs between the old and new image (`language` decides `language-mismatch`, R-12) |

So a title edit, a student-activity counter, the handler's own writes (translated tracks and the outcome) and every other change route nothing (FR-021, SC-008). The table's stream carries both images (`NEW_AND_OLD_IMAGES`, `common-constructs` `core-table.ts`).

The handler derives everything from current data, as the router requires of a feature:

- **A video record changed**: read the record and its course, call `planCaptionTranslations`, remove translated tracks that are no longer wanted, and translate what is missing (R-7).
- **A course's caption languages or teaching language changed**: read the course's curriculum (one query on the course's partition, no scan) and its preview, and for each video that has tracks set `captionTranslationRequestedAt` to now through a core-table helper (`requestCaptionTranslation`). Each of those writes is itself a stream record that passes the matcher, so each video becomes its own queue message. The handler never translates a whole course in one run.

This covers every trigger in the spec with one path:

| Trigger | How it reaches the handler |
|---------|---------------------------|
| New video, or replaced video (FR-004, FR-018) | transcribe-complete writes the new version's default track: the non-translated tracks changed |
| Source captions replaced or removed (FR-017, FR-020) | instructor-api's attach or remove changes the non-translated tracks |
| An uploaded track removed (FR-015) | the same |
| Caption languages changed (FR-019), or the course's teaching language changed (R-12) | the course record, then one touch per video |
| "Translate again" (FR-026) | instructor-api sets `captionTranslationRequestedAt` |

**Rationale**:
- It is the mechanism the constitution names for reacting to table changes (principle V), with retries, a failure queue, an alarm, a local runner and a fail switch for tests already built.
- Translation is decoupled from every writer of captions. transcribe-complete and instructor-api don't call Translate, don't wait for it and can't be failed by it (FR-023).
- No writer has to know the course's languages; only the handler does.

**Registration**: `batch: { maxRecords: 5, windowSeconds: 5 }`, `maxReceiveCount: 5`, `maxConcurrency: 2`. The Lambda's timeout is 15 minutes, so the queue's visibility timeout (six times the handler's) is 90 minutes.

**Duplicate and reordered delivery**: the plan is computed from the record as it is now, so a duplicate finds nothing left to do, and an older record processed after a newer one produces the newer state. Two runs for the same video at the same moment can each translate the same language once; the second write is dropped by `applyCaptionChange` (a translated track from the same source already exists) and its file is deleted. That is the only case where text is translated twice (FR-031); `maxConcurrency: 2` and the narrow matcher keep it rare, and its cost is one track.

**Alternatives considered**:
- **Translating inside transcribe-complete**. Couples a caption outcome to a second service, covers only one of the five triggers, and would make the handler's EventBridge retries re-run translation.
- **Instructor-api calling Translate when a file is uploaded or languages are saved**. An API request can't wait for nine languages of 100 videos, and API Gateway's time limit would cut it off.
- **Step Functions per video**. A state machine, its role and its local stand-in, for what is a loop with retries that the queue already gives.
- **Matching every `contentItem` change and deciding in the handler**. Works, but every student-activity write on a video would put a message on the queue.

## R-7: Translating one video

For the version the record plays now:

1. `planCaptionTranslations(tracks, { nonce, courseCaptionLanguages, courseLanguage, settings })` returns the source track, the languages to translate in priority order, the translated tracks to remove, and for each language not translated the reason (`uploaded`, `same-as-source`, `no-room`, `no-captions`, `language-mismatch`, `disabled`).
2. Remove unwanted translated tracks in one conditional write, then delete their files (best effort, as today's removals do).
3. Read the source track's file once. If its cue text is over 300,000 characters, record `too-long` for every language and stop (FR-030).
4. For each language, in order: translate (R-3), build the WebVTT (R-2), put the file at the version's `captions/<trackId>.vtt` (the existing key shape, so the signed cookies and the version's retirement cover it), then write the track through `applyCaptionChange` and `captionWriteCondition`. A lost condition is retried once from a fresh read; a dropped add deletes the file just written. The file is written before the track, so a track never points at nothing, as transcribe-complete does.
5. Write the outcome (`captionTranslation`, R-8) if it changed.

A language is finished and visible to students as soon as its own write lands; a later failure doesn't undo it (FR-024).

The handler stops starting new languages when less than two minutes of its run are left, and fails the message so the rest is done on the retry.

**Label**: a translated track's stored `label` is the language's `nativeLabel` ("Español"). The words "(auto-translated)" are added by the player from the track's origin (R-11), not stored, so they can be localised later (#292) without rewriting records.

## R-8: Failure handling

**Decision**: Translation failures are recorded on the video record and never touch `status`, `captionsStatus`, the default track or any other track.

- The handler writes `captionTranslation: { sourceTrackId, failures: [{ language, reason }], updatedAt }` after each run in which it changed. `reason` is `failed` (the service refused, errored or was throttled past the retries, or the output failed its checks) or `too-long`. A language that later succeeds is taken out of `failures`.
- The outcome is written **before** the handler fails its message for a retry. So the instructor sees "Translation failed" while the queue is still retrying, and if every retry fails and the message moves to the failure queue, the record already says so. Nothing has to notice the failure queue for the instructor's view to be right.
- Errors that a retry can't fix (an unsupported language pair, a validation error, too long) are recorded and the message is **not** failed, so it doesn't fill the failure queue with something redrive can't help.
- The instructor's status for a language is worked out when it is asked for, by the same `planCaptionTranslations` plus the stored outcome (data-model, "Reported status"): `translated`, `uploaded`, `failed`, `too-long`, `no-room`, `not-translated` with its reason, else `translating`. An outcome whose `sourceTrackId` isn't the current default track is ignored: it describes an earlier source.
- "Translate again" (FR-026) clears `captionTranslation` and sets `captionTranslationRequestedAt`, for one video (`contentItem.retryCaptionTranslation`) or for every video of a course and its preview (`course.retryCaptionTranslations`).

**What isn't covered**: a message that is lost before the handler ever runs leaves a language showing "Translating" with nothing in progress. The router's queues make that unlikely, the feature's failure-queue alarm shows the stuck work to an operator, and "Translate again" is offered whenever a language has no track, not only when it is marked failed. A time limit after which "Translating" is reported as failed (as `captionsStatus` has, two hours) was considered and left out: it needs a timestamp every caption writer would have to set, for a case the retry button already handles.

**Playback**: core-api and the player are unchanged in how they treat a video with fewer tracks. No request a student makes waits on, or can be failed by, translation (FR-023, SC-004).

## R-9: Stage settings and least privilege

**Stage config** (`common-infra-config`, a new `captionTranslation` key beside the other components):

| Key | Default | `discava-development` | `discava-production` |
|-----|---------|-----------------------|----------------------|
| `enabled` | `true` | `true` | `true` |
| `maxLanguagesPerCourse` | `9` | `3` | `9` |

The stack publishes both in the runtime config (`captionTranslation` namespace, one `Settings` object), where instructor-api and the handler read them through a new `common-server-utils/caption-translation-settings` module (`resolveCaptionTranslationSettings`). Under `LOCAL_DEV` it returns `{ enabled: true, maxLanguagesPerCourse: 9 }` from `common-server-utils/local-dev`.

- `enabled: false`: `course.updateCaptionLanguages` refuses, the settings card shows the choice as unavailable, and the planner returns `disabled` for every language, so nothing is translated. Existing translated tracks stay (FR-029).
- The lower development limit keeps a test course from translating into nine languages by default. The owner should confirm both values.

**IAM** for the `caption-translation` Lambda (FR-032), granted in `StreamRouterStack`:

| Grant | Scope |
|-------|-------|
| `translate:TranslateText` | `*`. The action's only resource types are custom terminologies and parallel data, which this feature doesn't use, so there is no ARN to scope to (**verified**: Service Authorization Reference, "Actions, resources, and condition keys for Amazon Translate"). The checkov rule this trips, if any, is suppressed with that reason, as `grantSubmitTranscodeJob` does for `mediaconvert:CreateJob` |
| Lesson media bucket: read, put, delete | `courses/*/captions/*` only (the existing `CAPTIONS_PATTERN`), which covers lesson and preview caption files and nothing else |
| Core table | read and write (it patches `contentItem` and `coursePreview` and reads `course`) |
| AppConfig | read, for the settings and the bucket name |

It gets no `comprehend:DetectDominantLanguage` (the source language is always stated, never `auto`), no access to the upload bucket, and no Transcribe or MediaConvert action. Text is sent to Translate over TLS and isn't stored by this feature anywhere but the caption file.

**Region**: whether Amazon Translate is offered in each stage's region is **unverified** (stages deploy to whatever region their credentials name). T048 checks it. If a stage's region lacks it, that stage sets `enabled: false`.

## R-10: Cost and how a stage sees it

**Unit**: Amazon Translate charges per character of text sent for translation, white space included (**verified**: `aws.amazon.com/translate/pricing/`). That page lists standard text translation at $15.00 per million characters, with a free tier of 2 million characters a month for an account's first 12 months. The price was read from the public page, not the Price List API, and no region was stated: treat it as **unverified** for the stage's region (T048).

**What drives it**: characters in the source track, times the number of languages translated. Nothing is charged for a language that already has a fresh translated track or an upload, and nothing when the feature is off.

**Scale, as an estimate only**: speech at 150 words a minute is about 9,000 words an hour, around 55,000 characters. At the listed price that is roughly $0.80 per hour of video per language, so a 20-hour course in nine languages would be on the order of $150, once. These figures are arithmetic on an assumed speaking rate, not measurements; T049 measures a real lecture.

**Bounds** (spec, clarification 5): the same source is not translated into the same language twice (R-6), a stage can lower the languages per course or turn translation off (R-9), and a source track over 300,000 characters is not translated (R-7). There is no spending quota per course or instructor.

**Observability per stage** (FR-028, SC-007):
- The handler emits CloudWatch metrics with Powertools, namespace `CaptionTranslation`, with the dimensions `Stage` (from a `STAGE_NAME` environment variable the stack sets) and `TargetLanguage`: `TranslatedCharacters` (source characters sent), `TranslatedTracks`, `TranslationFailures`, and `ChunkFallbacks` (R-3). The `Stage` dimension is what separates two stages that share an account.
- It logs one line per translated track with the course, the video, the language, the characters and the number of requests, so Logs Insights can answer "which course cost the most".
- Translate also publishes its own metrics per account and region, grouped by language pair and operation (**verified**: "CloudWatch metrics and dimensions for Amazon Translate"). The exact metric names were not read (**unverified**), and those metrics can't separate stages that share an account, so the feature doesn't rely on them. The bill itself shows Translate as its own service line per account.
- The design page gains a "Cost" section saying where to look and how to turn characters into money.

**Not built**: a dashboard, and an alarm on characters per day. Both are small follow-ups once real usage shows what a normal day looks like (open question in the PR).

## R-11: The label in the captions menu

**Decision**: core-api's video URL outputs (lesson and preview) add `machineTranslated: boolean` to each caption. `PlayerCaption` and `LoadedCaption` in `common-shadcn` carry it, and the player shows `"<label> (auto-translated)"` in the menu, in the control's accessible name and as the `<track>` element's label. The suffix is one exported constant.

**Rationale**: the output today deliberately leaves out a track's `source`. A boolean tells students what they need without exposing how the other tracks were made. The label for a translated track is the language's own name because the person looking for it may not read English; other tracks keep their stored labels, which an instructor may have written by hand.

**Remembered language**: the player already remembers the chosen track's `language` and picks a track with that language on the next video, so a student who picks Spanish once gets Spanish wherever it exists, translated or uploaded (User Story 1, scenario 3). No change is needed.

**Alternatives considered**: returning `source` whole (more than the student needs); baking the suffix into the stored label (can't be localised later, and an upload replacing the track would have to rewrite it).

## R-12: Captions transcribed in the wrong language

**Decision**: `planCaptionTranslations` returns `language-mismatch` for every language when the source track is `auto` and the course's catalogue `language` is set and isn't the base language of the track's tag (course `es`, track `en-US`). An uploaded source track is always translated.

**Rationale**: automatic captions are made in the stage's one configured language whatever the video's language (video player spec; `transcribe-client.ts`: "until a course can choose"). Transcribing Spanish speech as English produces nonsense, and translating nonsense into nine languages would be paid for nine times. The course's `language` is the only signal available, and it is optional: a course without one is translated.

**Alternative considered**: letting a course choose its transcription language. That is the real fix and belongs to the captions pipeline, not here (spec, Assumptions).

## R-13: The local stand-in

**Decision**: `packages/events/src/local/translator.ts` exports `translateLocally({ texts, sourceLanguage, targetLanguage })`, which the Translate client module (`media/translate-client.ts`) calls instead of the SDK when `LOCAL_DEV=true`.

- Each text comes back as `[<target tag>] <text>`, for example `[es-ES] Captions are generated by Amazon Transcribe when deployed.`, so a person or a test can see which track is showing and that the words are the source's.
- A request whose text contains `[[fail-translation]]`, or `[[fail-translation:<tag>]]` for one target language, throws the client's error for a refused language pair, which the handler records as failed without retrying. An e2e test uploads a source file with that marker to drive the failure path for its own video without affecting any other test or filling the failure queue. Queue-level retries are driven with the runner's existing `POST /router/fail/caption-translation`.
- It is a function call inside the event runner, not a route on port 2024. Translate is a synchronous call with nothing to report later, unlike Transcribe and MediaConvert, whose stand-ins exist to send a completion event.
- Everything around it is the real code: the stream router and the feature's ElasticMQ queue, the handler, the WebVTT helper, S3Mock, the track rules and the invariants.

**Only on a deployed stage**: Amazon Translate's real output, its line-break behaviour (R-3), throttling, and the metrics. CONTRIBUTING's "What only runs on dev" list gains them.

## R-14: Generators and where code goes

- The handler's Lambda construct (`EventsCaptionTranslation`) is made with the `ts#lambda-function` generator in `packages/events`, as every `events-*` function is (constitution II, and the stream router design page's "Adding a feature").
- No new project. `common-server-utils/webvtt` and `common-server-utils/caption-translation-settings` are new modules of a package imported per module.
- A new dependency: `@aws-sdk/client-translate` in `packages/events`.
- Portal code: the caption languages card is route-private to the instructor portal's course page (`-components/course/`). The player change is in `common-shadcn`, which all portals share.
