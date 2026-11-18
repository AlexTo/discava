# Data Model: Public Course Landing Pages and Instructor Profiles

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

All records live in the one core table, defined as ElectroDB entities in `packages/databases/core-table/src/entities/` (constitution V).

## Changed: `course`

| Attribute | Type | Rules |
|-----------|------|-------|
| `learningOutcomes` | list of string, optional | 0 to 10 items, each 1 to 160 characters after trimming; order is the instructor's |
| `requirements` | list of string, optional | Same rules as `learningOutcomes` |
| `previewContentItemId` | string, optional | The ID of a `contentItem` of this course with `type: 'video'`. Removed (not set to empty) when cleared |

- Written only through `courseLandingWrites` (`core-table/src/helpers/course-landing.ts`). That helper puts the course patch and every `courseInstructor.courseUpdatedAt` sync in one transaction, as `helpers/course-catalogue.ts` does. Setting `previewContentItemId` includes a condition check that the item exists with `type = video`.
- `deleteContentItemPermanently` (instructor-api) adds `courseLandingWrites.clearPreviewIfMatches(courseId, contentItemId)` to its transaction. When the item is the preview, the attribute is removed and `courseUpdatedAt` is synced.
- Archiving or hiding the item, its lesson or its module does **not** clear the reference. Readers treat the preview as unset unless the item is effectively visible and playable (FR-003, edge cases), so restoring it brings the preview back.
- **Stream impact**: the search indexer already reacts to `course` modifications and re-indexes. The new attributes are not in the search document, so the re-index does nothing visible. The progress filters ignore `course`; a test pins that.

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
| `contentItem`, `module`, `lesson` | Preview eligibility (already loaded by the curriculum read in `publicView`) |
| `courseRating` | The profile's course list (batch get) and structured data |
| `category` | Site map (active categories) and the landing page's category label |

## Access patterns

| # | Pattern | Request | Reads |
|---|---------|---------|-------|
| AP1 | Course landing page | `course.publicView` (extended) | `curriculum` collection (existing, all pages), then `courseInstructor` query by course and a batch get of `instructorProfile` (at most 25 keys). The rating summary comes from `review.summary` (existing) |
| AP2 | Preview playback | `course.previewVideoUrl` | `curriculum` collection by course (course, module, lesson and items in one query), then the preview item is found in memory |
| AP3 | Public profile by handle | `instructorProfile.publicView` | `profileHandleClaim` get → `instructorProfile` get → `courseInstructor.byInstructor` (gsi1) → batch get `course` (at most 100) and `courseRating` |
| AP4 | Instructor's own profile | `profile.get` / updates | `instructorProfile` get by `instructorId` |
| AP5 | Site map | renderer `GET /sitemap.xml` | `course.byStatus('published')` pages (gsi1); per course a `courseInstructor` query, run in parallel; batch get `instructorProfile`; active categories (existing query) |
| AP6 | Landing fields (instructor) | `course.updateLanding` | `course` get, plus a condition check on `contentItem` |

No pattern scans. Invariant tooling reads the table snapshot as it does today.

## Invariants (`core-table/src/helpers/invariants.ts`)

| Name | New or extended | Rule | Breaking test |
|------|-----------------|------|---------------|
| `course-landing-shape` | New | `learningOutcomes` and `requirements` each have at most 10 items, each 1 to 160 characters and already trimmed | An 11-item list; a whitespace-padded item |
| `course-preview-is-course-video` | New | If `previewContentItemId` is set, a `contentItem` with that ID exists under the same course with `type = video` | A preview pointing at a text item; at a deleted item |
| `instructor-has-profile` | New | Every `courseInstructor`'s `instructorId` has an `instructorProfile` | A `courseInstructor` without a profile |
| `profile-handle-claims-consistent` | New | Every profile's `handle` has exactly one claim owned by that profile, and every claim's owner has a profile with that handle | An orphan claim; a profile whose claim belongs to someone else |
| `instructor-profile-shape` | New | Field lengths, handle pattern and `version >= 1` | A 61-character display name; a handle with `--` |
| `instructor-course-updated-at` | Extended (tests only) | Unchanged rule; new tests show that `courseLandingWrites` and `clearPreviewIfMatches` keep it | Landing write without the sync |

## State and lifecycle

- **Preview**: unset, then set (by the instructor), then unset again (by the instructor, or automatically on permanent deletion of the item). Whether a set preview is *shown* is derived on every read: course published, item playable, item, lesson and module visible.
- **Profile visibility**: derived on every read. The profile is public if and only if the instructor teaches at least one course with `status = published`. No stored flag can drift.
- **Handle**: generated when the profile is created, then changed by the instructor at any time. The old handle's claim is deleted in the same transaction, so it becomes free at once, and the old address returns not found (constitution VII).
