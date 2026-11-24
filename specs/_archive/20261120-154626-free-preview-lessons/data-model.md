# Data Model: Free Preview Lessons

One optional attribute on an existing entity. No new entity, index or key.

## `lesson` (existing, `packages/databases/core-table/src/entities/lesson.ts`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `freePreview` | boolean, optional | **New.** Present with the value `true` when an instructor has marked the lesson as a free preview; removed when it is unmarked. Never stored as `false`. Only a lesson of `kind` `lesson` carries it. Absent on every existing lesson, which means not marked |

Keys are unchanged: the lesson stays in the `curriculum` collection (`pk` composite `courseId`, `sk` composite `moduleId`, `lessonId`).

### Rules

1. **Who writes it.** Only instructor-api's `lesson.setFreePreview` ([contracts/instructor-api-lesson.md](./contracts/instructor-api-lesson.md)). The write is one item in a `writeUnderActiveAncestors` transaction, conditioned on the lesson having no `archivedAt` and `kind = 'lesson'`. No other lesson write (create, update, publish, hide, archive, restore, reorder, delete) reads or changes it.
2. **Marked is not open.** Whether visitors can read the lesson is not stored. It is computed for every request by `isOpenFreePreview` in `core-table/src/helpers/curriculum.ts`:

   | Input | Must be |
   |-------|---------|
   | `course.status` | `published` |
   | `module` | `isShown` (visibility `visible`, no `archivedAt`) |
   | `lesson` | `isShown`, `kind` `lesson`, `freePreview === true` |

3. **Items.** An item of an open preview lesson is part of the preview only while `isShown(item)`. Items carry no mark of their own.
4. **Nothing else is written.** Opening a preview writes no record of any entity.

### State of a marked lesson

| Change by the instructor | The mark | Open to visitors |
|--------------------------|----------|------------------|
| Mark a visible lesson in a published course | set | yes, from the next request |
| Mark a lesson in a draft course, or a hidden lesson | set | no, until the lesson is visible in a published course |
| Unmark | removed | no, from the next request |
| Hide or archive the lesson or its module | kept | no, from the next request |
| Publish (show) or restore it again | kept | yes again |
| Archive the course | kept | no |
| Move or reorder the lesson | kept | unchanged |
| Change the course's price, either way | kept | unchanged |
| Delete the lesson permanently | gone with the lesson | no |

## Access patterns

Every read is by key on the primary index. No scan, no new index.

| Request | Reads |
|---------|-------|
| `lesson.setFreePreview` (instructor-api) | `lesson.get`; the ancestor checks `writeUnderActiveAncestors` already makes; one transaction |
| `freePreview.lesson` (core-api) | `course.get`, `module.get`, `lesson.get`, then `contentItem.query.primary({ courseId, moduleId, lessonId })`, every page (a lesson's items are a contiguous range of the sort key) |
| `freePreview.videoUrl`, `freePreview.fileUrl` (core-api) | `course.get`, `module.get`, `lesson.get`, `contentItem.get` with the full key |
| `course.publicView` (core-api, existing) | unchanged: the `curriculum` collection query it already makes; lessons now carry `freePreview` in the output |

## Invariants

In `packages/databases/core-table/src/helpers/invariants/`:

| Check | File | Rule | Change |
|-------|------|------|--------|
| `free-preview-on-ordinary-lesson` | `curriculum.ts` | A lesson whose record has `freePreview` has the value `true` and `kind` `lesson` | **New**, with breaking tests: an assignment lesson carrying the mark; a lesson storing `false` |
| `paid-course-enrolment-paid` | `payments.ts` | In a priced course, an enrolment with no order was created before the price | **Unchanged rule.** The comment names open preview lessons as the one way content is read without an enrolment. Two tests added: with a marked lesson present, an unpaid late enrolment is still a violation, and no enrolment at all is not |
| `student-records-enrolled` | `student-activity.ts` | Every student record belongs to an enrolment | Unchanged. It is what a preview that recorded something would break; the e2e scenario relies on it |

`TableSnapshot` already loads lessons, so `snapshot.ts` and the coverage test need no change.

## Stream

A mark change is a `lesson` MODIFY. Of the registrations in `STREAM_FEATURES` it matches only `progress-recalculation` (every curriculum MODIFY does), which recomputes the same figures because the mark is not an input to progress. A test pins both halves.

## Not stored

- Whether a lesson is open (computed, rule 2).
- Anything about a visitor: no view count, no position, no record of what was opened.
