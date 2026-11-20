# Implementation Plan: Machine-Translated Caption Tracks

**Branch**: `20261120-154712-caption-translation` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261120-154712-caption-translation/spec.md`

## Summary

An instructor chooses a course's caption languages. A new feature of the core table's stream router, `caption-translation`, then keeps every video of the course in line with that choice: when a video's source track or the course's languages change, its handler translates the source track's cue text with Amazon Translate (`TranslateText`), writes one WebVTT file per language with the source's timing lines copied unchanged, and adds each as a caption track with `source: 'translated'`. The existing track rules in core-table (`applyCaptionChange`) are extended so that an upload always beats a translated track, a translated track is never the default, and replacing the source drops its translations in the same write. core-api tells the player which tracks are machine-translated, and the player shows "Español (auto-translated)". Locally the Translate call is replaced by a function that prefixes each cue with the target language. Each stage can turn the feature off or lower the number of languages per course, and sees the characters it translated in its own CloudWatch metrics.

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: `@aws-sdk/client-translate` (new, in `packages/events`), `@aws-sdk/client-s3`, AWS Lambda Powertools (logger, tracer, metrics), ElectroDB through `@discava/core-table`, tRPC and zod (`@discava/instructor-api`, `@discava/core-api`), `@discava/common-server-utils`, `@discava/common-web-utils/caption-languages`, `@discava/common-shadcn` (`HlsVideo`, `VideoControls`), AWS CDK through `@discava/common-constructs`

**Storage**: The one core table: new attributes on `course`, `contentItem` and `coursePreview`, no new entity or index ([data-model.md](./data-model.md)). Translated WebVTT files in the lesson media bucket, in each version's existing `captions/` folder

**Testing**: vitest unit tests (core-table track rules, planner and invariants; the WebVTT helper; the Translate client and the handler with the SDK and S3 mocked; instructor-api and core-api procedures), portal component tests (`renderWithInstructorApi`, the player's tests in `common-shadcn`), construct and stack tests with `synth`, and Playwright scenarios and one concurrency test in `packages/e2e` with `screenshot()`

**Target Platform**: AWS Lambda fed by the stream router's SQS queue, Amazon Translate, S3 and CloudFront. Locally `pnpm dev` with the event runner, ElasticMQ and S3Mock

**Project Type**: Web application: a serverless backend plus React portals

**Performance Goals**: Every translated track of a video up to two hours long within 15 minutes of its source captions becoming ready, for 95% of videos (SC-001). No student request waits on translation

**Constraints**:
- Cue count, order and timing lines identical to the source (SC-002), checked before a file is written.
- An uploaded track is never replaced, by construction of the conditional write (SC-003).
- Translation never touches `status`, `captionsStatus` or the default track (SC-004).
- Nothing is translated unless a source track or a course's languages changed (SC-008).
- `translate:TranslateText` only, and S3 access to `courses/*/captions/*` only.
- Works under `pnpm dev` with no AWS account.

**Scale/Scope**: At most 9 languages per course and 10 tracks per video. One handler, one stream registration, two new `common-server-utils` modules, four new instructor-api procedures and four changed, one changed output in core-api, one player change, one new card and one changed dialog in the instructor portal, one e2e scenario file, one design-page section. A source track is at most 1 MB and is not translated above 300,000 characters

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: still passes.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Amazon Translate, Lambda, SQS (the existing stream router), S3. No other provider (research R-1) |
| II. Generators first | Pass | The handler's Lambda construct comes from `ts#lambda-function`, as every `events-*` function does. No new project. Adding a tRPC procedure, a stream registration or a portal component has no generator (R-14) |
| III. Everything runs locally | Pass | `translateLocally` stands in for Amazon Translate under `LOCAL_DEV` (R-13). The router, queue, handler, S3 and track rules run for real. What only a deployed stage exercises is listed in R-13 and added to CONTRIBUTING |
| IV. Layered tests | Pass, planned | Unit tests for every new rule and procedure. Invariants extended and added (below). An e2e scenario file and a concurrency test, since the instructor's course-building flow and the student's learning flow both change |
| V. Single-table via ElectroDB | Pass | Attributes on existing entities, no new index. Every access is by key or the course's partition (data-model, access patterns); no scan. A new `STREAM_FEATURES` registration with a narrow matcher; existing registrations reviewed and unchanged |
| VI. Secure by default | Pass | The Lambda gets one Translate action, S3 access to caption files only, and no Comprehend, Transcribe, MediaConvert or upload-bucket access (R-9). Translated files are served exactly as other caption files are. Translated text is escaped before it is written and shown as plain text. The feature's stage defaults are the unrestricted ones (`enabled: true`, 9 languages): they are cost limits, not security relaxations |
| VII. Change freely before launch | Pass | `source` gains a value and core-api's caption output gains a field, outright. No fallback for records without the new attributes is needed: absent means none |
| VIII. Repo conventions | Pass | `helpers/` files named for what they cover; shared runtime code in `common-server-utils`; the card is route-private to the instructor portal; text-only buttons; kebab-case file names; e2e screenshots; English docs with translations noted as pending |

**Impact check (constitution IV).** Shared records this feature writes, or reads in a new way:

| Record | Change | Existing invariants and tests that cover it | Extended or added |
|--------|--------|---------------------------------------------|-------------------|
| `contentItem` (video) | `captionTracks` gains translated tracks and `sourceTrackId`; new `captionTranslation`, `captionTranslationRequestedAt`. A new writer: the translation handler | `caption-tracks-valid`, `video-transcode-state` (`invariants/media.ts`, `media.test.ts`); `caption-tracks.test.ts`; `transcribe-outcome.test.ts`; `content-item-captions` procedure tests; `caption-attach.e2e.ts` | `caption-tracks-valid` extended with the four translated-track rules; `video-transcode-state` extended to the two new attributes; a breaking test for each |
| `coursePreview` | the same attributes; translated tracks appear on a record whose captions were automatic only | the preview branches of the same two checks; `transcribe-outcome.preview.test.ts` | the same extensions; the "automatic only" comment and its test description change, the check itself doesn't |
| `course` | new `captionLanguages`; a new writer function | `instructor-course-updated-at` (kept, because the writer refreshes it); catalogue checks | new `course-caption-languages-valid` with a breaking test |

`studentActivityCount`, completions, enrolments and progress are not read or written. The meaning of `captionTrackCount` on an instructor's video row widens to include translated tracks; the plan keeps it a count of every track and the portal test that shows it is updated in the task that adds translated tracks to the dialog.

**Weakened or changed tests (constitution IV).** Two intended changes, each named in its task and to be repeated in that PR's description:

- core-api's video URL tests assert that a caption carries no `source`. They keep asserting that, and gain `machineTranslated`. Any test that pins the caption object's exact shape changes to include the new field.
- `video-captions-dialog.test.tsx` expects the badge to print the raw `source` ("auto", "uploaded"). The badge text becomes "Automatic", "Uploaded" or "Auto-translated" (FR-011), so those expectations change.

No other existing assertion is loosened. `applyCaptionChange`'s existing cases must pass unchanged: the new rules only apply when a translated track is involved.

## Design Decisions (detail in [research.md](./research.md))

1. **`TranslateText`, not batch jobs or document translation** (R-1). Synchronous, no job bookkeeping, and every language pair works.
2. **Timings are copied, never translated** (R-2). Only cue text is sent; the output is checked against the source before it is written.
3. **Cues go in line-separated chunks of at most 5,000 bytes, with a per-cue fallback** (R-3), so the design is right whether or not the service keeps line breaks.
4. **`course.captionLanguages`**, an ordered list of the existing caption language tags, at most 9 (R-4).
5. **`source: 'translated'` with `sourceTrackId`, and all rules in `applyCaptionChange`** (R-5). The upload wins through the same conditional write that already protects it from a late Transcribe result.
6. **One stream feature, `caption-translation`, for every trigger** (R-6): a new or replaced video, a changed source track, a changed language list, and "Translate again".
7. **Failures are recorded on the record before a retry is asked for** (R-8), so the instructor's view is right even when the queue gives up.
8. **Per-stage switch and limit in stage config; one Translate action in IAM** (R-9).
9. **Characters per stage and language as CloudWatch metrics** (R-10).
10. **`machineTranslated` in core-api's output; the player adds the suffix** (R-11).
11. **Automatic captions in the wrong language aren't translated** (R-12).
12. **An in-process local stand-in with failure markers** (R-13).

## Project Structure

### Documentation (this feature)

```text
specs/20261120-154712-caption-translation/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-1 to R-14, with what is verified
├── data-model.md        # Phase 1: attributes, track rules, planner, invariants
├── quickstart.md        # Phase 1: how to check it by hand
├── contracts/
│   ├── instructor-api-caption-languages.md   # new and changed instructor-api procedures
│   ├── translation-handler.md                # stream registration, handler, client, stand-in, metrics, IAM
│   └── player-and-portal-ui.md               # core-api output, player label, portal UI, e2e
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/common/web-utils/src/
└── caption-languages.ts                 # + nativeLabel per language, captionNativeLabel()

packages/common/server-utils/src/
├── webvtt.ts                            # new: parseWebVtt, serialiseWebVtt, cueText
├── webvtt.test.ts                       # new
├── caption-translation-settings.ts      # new: resolveCaptionTranslationSettings()
├── caption-translation-settings.test.ts # new
└── local-dev.ts                         # + the local settings

packages/databases/core-table/src/
├── entities/content-item.ts             # captionAttributes: source 'translated', sourceTrackId,
│                                        #   captionTranslation, captionTranslationRequestedAt
├── entities/course.ts                   # + captionLanguages
├── helpers/caption-tracks.ts            # applyCaptionChange rules, planCaptionTranslations,
│                                        #   requestCaptionTranslation, writeCaptionTranslationOutcome
├── helpers/caption-tracks.test.ts       # + the new rules
├── helpers/course-catalogue.ts          # + setCourseCaptionLanguages
├── helpers/caption-translation-stream.ts       # new: filters and matcher
├── helpers/caption-translation-stream.test.ts  # new
├── helpers/stream-features.ts           # + the registration and its matcher
├── helpers/invariants/media.ts          # extended checks, + course-caption-languages-valid
├── helpers/invariants/media.test.ts     # + a breaking test per rule
└── entity-writers.json                  # regenerated

packages/events/src/
├── media/caption-translation.ts                # new: the feature's handler
├── media/caption-translation.test.ts           # new
├── media/caption-translation-outcome.ts        # new: translateVideoCaptions
├── media/caption-translation-outcome.test.ts   # new
├── media/translate-client.ts                   # new: translateTexts, TRANSLATE_LANGUAGE_CODES
├── media/translate-client.test.ts              # new
├── local/translator.ts                         # new: translateLocally
├── local/translator.test.ts                    # new
└── router/handlers.ts                          # + 'caption-translation'

packages/common/constructs/src/app/lambda-functions/
└── events-caption-translation.ts        # generated by ts#lambda-function

packages/common/infra-config/src/
├── stages.types.ts                      # + captionTranslation { enabled, maxLanguagesPerCourse }
├── stages.config.ts                     # development 3 languages, production 9
└── env-overrides.ts                     # + the two keys

packages/infra/src/
├── stacks/stream-router-stack.ts        # createCaptionTranslationLambda, grants, runtime config
├── stacks/stream-router-stack.test.ts   # + the policy assertions (or the stage test that covers the stack)
└── stages/application-stage.ts          # passes the lesson media bucket and the stage's config

packages/apis/instructor-api/src/
├── schema/course.ts                     # caption language schemas
├── schema/content-item.ts               # source enum, translations
├── procedures/course-caption-languages.ts        # new: captionLanguages, updateCaptionLanguages,
│                                                 #   retryCaptionTranslations
├── procedures/course-caption-languages.test.ts   # new
├── procedures/content-item-captions.ts  # attach evicts and cleans up; remove refuses translated;
│                                        #   retryCaptionTranslation
├── procedures/content-item-video.ts     # createVideoUrl: translations
├── procedures/course-preview.ts         # createVideoUrl: translations
├── helpers/caption-translations.ts      # new: the reported status of a record
└── router.ts                            # the four new procedures

packages/apis/core-api/src/
├── schema/content-item.ts               # captions[].machineTranslated
├── procedures/content-item.ts           # sets it
└── procedures/course.ts                 # sets it for the preview

packages/common/shadcn/src/components/
├── hls-video.tsx                        # PlayerCaption.machineTranslated, <track label>
└── video-controls.tsx                   # captionMenuLabel, AUTO_TRANSLATED_SUFFIX

packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/
├── route.tsx                                              # renders the card
├── -components/course/course-caption-languages-form.tsx   # new
├── -components/course/course-caption-languages-form.test.tsx
└── -components/content-items/video-captions-dialog.tsx    # badges, no Remove, Translations list, retry

packages/e2e/src/
├── helpers/captions.ts                  # + chooseCaptionLanguages, expectCaptionTrack, …
├── scenarios/caption-translation.e2e.ts # new
└── concurrency/caption-attach.e2e.ts    # + upload against a language change

docs/src/content/docs/en/
├── design/video-player.mdx              # + "Translated captions" and "Cost", "Spec" link
├── design/stream-event-router.mdx       # + the feature's row in the metrics table
└── guides/instructor-guide.mdx          # + choosing caption languages

CONTRIBUTING.md, packages/events/CLAUDE.md   # the stand-in and what only runs on dev
```

**Structure Decision**: The translation step lives in `packages/events` as a stream-router feature, beside the other media handlers, because it reacts to table changes and must not be in the path of any API request. Every rule about which tracks may exist is in core-table's `helpers/caption-tracks.ts`, which instructor-api, transcribe-complete and the new handler all call, so no writer can disagree (constitution IV). The WebVTT parser and the settings resolver go in `common-server-utils` because two backend packages use them (the handler now, instructor-api for the settings, and transcript search later for the parser). The Lambda and its grants go in `StreamRouterStack`, where every feature handler is built, which needs the lesson media bucket passed in from the Data stack it already depends on.

**Delivery**: seven phases, each one pull request that leaves `main` working ([tasks.md](./tasks.md)). Nothing a user sees changes until the third; the first two put the rules and the worker in place with no way to set a language yet.

## Risks

| Risk | Mitigation |
|------|------------|
| Amazon Translate doesn't keep line breaks one for one | The per-cue fallback (R-3) keeps the result correct; `ChunkFallbacks` shows how often; T049 checks on the development stage |
| Caption-by-caption translation reads badly | A person judges real lectures before production is turned on (T050); a stage can keep `enabled: false` meanwhile |
| Cost grows faster than expected | Languages per course are capped per stage, a source is never translated twice, 300,000-character limit, per-stage metrics (R-10) |
| The service throttles a large course | Two handler runs at once, four requests at once per language, SDK backoff, and the queue's retries. A language that still fails is recorded and can be tried again |
| A lost queue message leaves "Translating" showing | The failure queue's alarm, and "Translate again" is offered for any language without a track (R-8) |
| Translate isn't offered in a stage's region | T048 checks; that stage sets `enabled: false` |

## Complexity Tracking

No violations to justify.
