# Contract: instructor-api landing page and profile procedures

All procedures build on `courseProcedure`, which requires the `instructor` group and gives access to the core table. Course procedures also require the caller to be an instructor of the course (`courseInstructor` exists), or they return `FORBIDDEN`, as the existing course procedures do.

## `course.updateLanding` (new)

**Input**:

```ts
{
  courseId: string;
  learningOutcomes: string[];        // replaces the list; [] clears it
  requirements: string[];            // replaces the list; [] clears it
  previewContentItemId: string | null;   // null clears it
}
```

**Validation** (zod, before any read): each list has at most 10 items. Each item is trimmed and must then be 1 to 160 characters. A violation returns `BAD_REQUEST` with a message naming the field and position.

**Behavior**: One `courseLandingWrites.set` transaction: the course patch, the `courseInstructor.courseUpdatedAt` sync for every instructor, and (when the preview is non-null) a condition check that a `contentItem` with that ID exists under this course with `type = video`. If that check fails, the result is `BAD_REQUEST`, "Choose a video from this course". It works in any course status, including `archived`, since the page is just not public then.

**Output**: The updated course, in the same shape as `course.view`.

## `course.view` (extended)

The output gains `learningOutcomes`, `requirements` and `previewContentItemId`, so the portal can show and edit them and work out the checklist.

## `contentItem.deletePermanently` (changed)

Its transaction gains `courseLandingWrites.clearPreviewIfMatches`. Deleting the current preview clears it and keeps `courseUpdatedAt` in sync. Tests: deleting the preview clears it; deleting another item leaves it.

## `course.create` (changed)

It calls `ensureInstructorProfile(caller)` just before its transaction (idempotent; the handle retry loop cannot run inside a transaction). The test pins that a first course creates exactly one profile and claim, and that a second course creates none.

## `profile.get` (new)

**Input**: none. **Output**: the caller's `instructorProfile` (`handle`, `displayName`, `headline?`, `bio?`, `photoKey?`, `version`), plus `isPublic: boolean`, which is true when the caller teaches a published course. If the caller has no profile yet (an instructor who never created a course), the procedure returns a default built from the user record, with `version: 0`, and writes nothing.

## `profile.update` (new)

**Input**: `{ version: number; displayName: string; headline?: string; bio?: string; handle: string }`

**Validation**: lengths as in [data-model.md](../data-model.md). The handle is lower-cased and must match the pattern. A reserved handle (the list in [data-model.md](../data-model.md)) returns `BAD_REQUEST`.

**Behavior**:
- With `version: 0`, it calls `ensureInstructorProfile(caller, { fields, handle })` with the explicit handle, so a taken handle gives `CONFLICT` and is never swapped for a generated one. If a profile already exists by then (created concurrently), it returns `CONFLICT` "Your profile changed; reload and try again".
- Otherwise it calls `update`, plus `changeHandle` when the handle differs, all in one transaction, conditioned on `version`.

**Errors**:
- `CONFLICT` "That handle is taken" when the new claim exists.
- `CONFLICT` "Your profile changed; reload and try again" on a version mismatch.

**Output**: the saved profile.

## `profile.createPhotoUploadUrl` / `profile.updatePhoto` (new)

These mirror `course.createImageUploadUrl` and `course.updateImage`. The key is `instructors/<caller>/<uuid>.jpg`, a presigned JPEG PUT of at most 2 MB, verified by `headPublicMediaObject` before attach. `photoKey: null` removes the photo. The previous photo is detached on a best-effort basis.

## Router and portal client

All new procedures are registered in `instructor-api/src/router.ts`. They get no dedicated function except `profile.createPhotoUploadUrl` and `profile.updatePhoto`, which join whichever function already holds the course image's public media rights (the same grants).
