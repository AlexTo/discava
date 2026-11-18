# Data Model: Public Course Landing Pages and Instructor Profiles

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

All records live in the one core table, defined as ElectroDB entities in `packages/databases/core-table/src/entities/` (constitution V).

## Changed: `course`

| Attribute | Type | Rules |
|-----------|------|-------|
| `learningOutcomes` | list of string, optional | 0 to 10 items, each 1 to 160 characters after trimming; order is the instructor's |
| `requirements` | list of string, optional | Same rules as `learningOutcomes` |

- Written only through `courseLandingWrites` (`core-table/src/helpers/course-landing.ts`). That helper puts the course patch and every `courseInstructor.courseUpdatedAt` sync in one transaction, as `helpers/course-catalogue.ts` does.
- **Stream impact**: the search indexer already reacts to `course` modifications and re-indexes. The new attributes are not in the search document, so the re-index does nothing visible. The progress filters ignore `course`; a test pins that.

## New: `coursePreview`

One per course at most: the instructor-uploaded preview video. It is a separate record so that processing and caption updates never touch `course.updatedAt` (research R-6).

| Attribute | Type | Rules |
|-----------|------|-------|
| `courseId` | string, required | The key |
| `status` | `processing` \| `ready` \| `failed`, required | As a lesson video's `status` |
| `s3Key` | string, optional | This attempt's manifest, `courses/<courseId>/preview/<submissionNonce>/master.m3u8`, once ready |
| `previousS3Key` | string, optional | The version kept playable while a replacement processes or after it failed |
| `submissionNonce` | string, required | The current attempt; scopes output paths and conditions every pipeline write |
| `mimeType`, `mediaConvertJobId`, `rawObjectETag` | string, optional | As on lesson videos: the upload's type, the job that must match a completion event (#123), and the ETag that tells a retry from a replacement |
| `transcodePending`, `transcodePendingSince` | `'pending'` and ISO string, optional | Set together while an attempt waits for its transcode and removed together when it ends, exactly as on lesson videos (#125) |
| `failureReason` | `too-long` \| `transcode-error`, optional | New (lesson videos have none). Set only when `failed`, so the editor can say why |
| `durationSeconds` | number, required | 1 to 300 (the 5-minute cap); declared at upload and replaced by the transcoded duration |
| `captionTracks`, `captionTracksRev`, `captionsStatus`, `captionsPendingSince` | as on `contentItem` | Automatic captions only; written through `helpers/caption-tracks.ts` |
| `uploadedBy` | string, required | The instructor who started the current attempt (never exposed publicly) |
| `createdAt`, `updatedAt` | string, required | Standard |

**Keys**: `pk` is `courseId` and `sk` is a constant. It shares the course's partition but is not part of the `curriculum` collection: no read needs it with the curriculum, and keeping it out stops the curriculum queries growing.

**Index**: a sparse `byTranscodePending` on the existing `gsi1pk-gsi1sk-index` (composites `transcodePending`, then `transcodePendingSince`), the same definition lesson videos use. It serves one named pattern: the transcode reconciler finding previews stuck waiting (AP8). ElectroDB prefixes keys with the entity name, so it never returns lesson videos and lesson queries never return it.

**Written by**:
- instructor-api's `coursePreview.createUploadUrl`, `create`, `replace` and `remove` (`contracts/instructor-api-landing.md`), each conditioned on the `submissionNonce` it read;
- the pipeline handlers, conditioned on the job's `submissionNonce`, through the same outcome functions lesson videos use, made target-aware;
- `remove` deletes the record and schedules cleanup of every version's folder.

## New: `instructorProfile`

| Attribute | Type | Rules |
|-----------|------|-------|
| `instructorId` | string, required | Cognito `sub`; the key |
| `handle` | string, required | 3 to 30 characters, `^[a-z0-9]+(-[a-z0-9]+)*$`; unique through `profileHandleClaim`; never one of the reserved handles below |
| `displayName` | string, required | 1 to 60 characters; defaults to the user's `givenName familyName`, else "Discava instructor" |
| `headline` | string, optional | Up to 100 characters |
| `bio` | string, optional | Up to 2,000 characters; plain text, `\n\n` separates paragraphs |
| `photoKey` | string, optional | Public media key `instructors/<instructorId>/<uuid>.jpg` |
| `version` | number, required | Starts at 1; incremented by every profile edit; edits are conditioned on it (optimistic concurrency) |
| `createdAt`, `updatedAt` | string, required | Standard |

**Keys**: `pk` is `instructorId` and `sk` is `instructorId` (primary only). It has no index.

**Reserved handles** (the single list; code and contracts refer to it): `admin`, `instructors`, `learn`, `search`, `category`, `certificates`, `my-learning`, `signin`, `sitemap`, `robots`.

**Written by** `instructorProfileWrites` in `core-table/src/helpers/instructor-profile.ts`:

- `ensureInstructorProfile(instructorId, { fields?, handle? })` creates the profile and its claim if missing (idempotent). With no `handle` it tries generated candidates; with an explicit `handle` it tries only that one and reports `handle-taken`. It is called by `createCourse` just *before* the course transaction (the handle retry loop cannot run inside one transaction; the call is idempotent, and a profile without a course breaks no invariant), and by the local seed script for seeded instructors.
- `update(instructorId, version, patch)` covers display name, headline and bio.
- `changeHandle(instructorId, version, from, to)` is one transaction: claim create (the new handle must not exist), claim delete (the old claim must belong to this instructor), and profile update (`handle = from`, `version` matches).
- `setPhoto(instructorId, photoKey | null)` follows the course-image attach and detach flow.

## New: `profileHandleClaim`

| Attribute | Type | Rules |
|-----------|------|-------|
| `handle` | string, required | The claimed handle; the key |
| `instructorId` | string, required | The owner |
| `createdAt` | string, required | Standard |

**Keys**: `pk` is `handle` and `sk` is `handle` (primary only). It is created with an `attribute_not_exists` condition, and is written only by `instructorProfileWrites`.

## Read-only, used in new ways

| Record | New use |
|--------|---------|
| `courseInstructor` | Instructor cards (query by `courseId`, ordered by `createdAt`), the profile's course list (`byInstructor` on gsi1), and the site map |
| `user` | The default display name when a profile is created; never read on public requests |
| `courseRating` | The profile's course list (batch get) and structured data |
| `category` | Site map (active categories) and the landing page's category label |

## Access patterns

| # | Pattern | Request | Reads |
|---|---------|---------|-------|
| AP1 | Course landing page | `course.publicView` (extended) | `curriculum` collection (existing, all pages), then `courseInstructor` query by course and a batch get of `instructorProfile` (at most 25 keys). The rating summary comes from `review.summary` (existing) |
| AP2 | Preview playback | `course.previewVideoUrl` | `course` get and `coursePreview` get (two keyed reads, in parallel) |
| AP2a | Preview on the landing page | `course.publicView` (extended) | One extra `coursePreview` get beside the curriculum query |
| AP3 | Public profile by handle | `instructorProfile.publicView` | `profileHandleClaim` get → `instructorProfile` get → `courseInstructor.byInstructor` (gsi1) → batch get `course` (at most 100) and `courseRating` |
| AP4 | Instructor's own profile | `profile.get` / updates | `instructorProfile` get by `instructorId` |
| AP5 | Site map | renderer `GET /sitemap.xml` | `course.byStatus('published')` pages (gsi1); per course a `courseInstructor` query, run in parallel; batch get `instructorProfile`; active categories (existing query) |
| AP6 | Landing fields (instructor) | `course.updateLanding` | `course` get |
| AP7 | Preview upload and pipeline | `coursePreview.*`, pipeline handlers | `coursePreview` get by course; conditional writes on `submissionNonce` |
| AP8 | Reconciler: stuck previews | `transcode-reconciler` | `coursePreview.byTranscodePending({ transcodePending: 'pending' })` beside the existing lesson-video query |

No pattern scans. Invariant tooling reads the table snapshot as it does today.

## Invariants (`core-table/src/helpers/invariants.ts`)

| Name | New or extended | Rule | Breaking test |
|------|-----------------|------|---------------|
| `course-landing-shape` | New | `learningOutcomes` and `requirements` each have at most 10 items, each 1 to 160 characters and already trimmed | An 11-item list; a whitespace-padded item |
| `course-preview-shape` | New | Every `coursePreview` has a `course`; `durationSeconds` is 1 to 300; `status` is valid; `ready` has `s3Key` under its own `courses/<courseId>/preview/<submissionNonce>/` folder; `failed` has `failureReason` and no other status has one; `transcodePending` and `transcodePendingSince` are set together and only while `processing`; `previousS3Key`, when set, is under the same course's `preview/` folder | A preview with no course; a 301-second preview; a `ready` preview with no `s3Key`; an `s3Key` under another course |
| `video-transcode-state`, `caption-tracks-valid` | Extended | The existing lesson-video rules (status and key consistency, caption tracks belonging to a played version) also apply to `coursePreview` | The existing breaking cases, repeated for a preview record |
| `instructor-has-profile` | New | Every `courseInstructor`'s `instructorId` has an `instructorProfile` | A `courseInstructor` without a profile |
| `profile-handle-claims-consistent` | New | Every profile's `handle` has exactly one claim owned by that profile, and every claim's owner has a profile with that handle | An orphan claim; a profile whose claim belongs to someone else |
| `instructor-profile-shape` | New | Field lengths, handle pattern and `version >= 1` | A 61-character display name; a handle with `--` |
| `instructor-course-updated-at` | Extended (tests only) | Unchanged rule; new tests show that `courseLandingWrites` keeps it, and that preview writes never change `course.updatedAt` | Landing write without the sync |

## State and lifecycle

- **Preview**: none → `processing` (upload) → `ready` or `failed`; a replacement goes `ready` → `processing` with `previousS3Key` kept → `ready` (previous scheduled for cleanup) or `failed` (previous kept playing); `remove` deletes the record. Whether it *shows* is derived on every read: course published and a playable version exists.
- **Profile visibility**: derived on every read. The profile is public if and only if the instructor teaches at least one course with `status = published`. No stored flag can drift.
- **Handle**: generated when the profile is created, then changed by the instructor at any time. The old handle's claim is deleted in the same transaction, so it becomes free at once, and the old address returns not found (constitution VII).
