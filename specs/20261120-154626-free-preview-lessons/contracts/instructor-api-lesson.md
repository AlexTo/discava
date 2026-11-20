# Contract: instructor-api `lesson.setFreePreview`

A tRPC **mutation** in `packages/apis/instructor-api/src/procedures/lesson.ts`, built with `courseInstructorProcedure` like the other lesson procedures, so only an instructor of the course can call it.

## Input

```ts
SetLessonFreePreviewInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  freePreview: z.boolean(),
});
```

## Output

`LessonSchema`, which gains `freePreview: z.boolean()`. Every procedure that returns a lesson (create, update, publish, hide, restore, and the course view) now returns it, `true` only when the record carries the mark.

## Behaviour

1. Read the lesson (`NOT_FOUND` if missing).
2. Refuse an archived lesson ("Restore the lesson before changing its free preview") and archived ancestors, with the guards `updateLesson` uses (`requireNotArchived`, `requireAncestorsNotArchived`), which also refuse an archived course.
3. If `freePreview` is `true` and the lesson's `kind` is `assignment`: `BAD_REQUEST` "Assignment lessons can't be free previews".
4. If the lesson already has the requested state, return it unchanged.
5. Otherwise write in one `writeUnderActiveAncestors` transaction: a patch that sets `freePreview: true`, or removes the attribute, conditioned on `archivedAt` not existing and, when marking, on `kind = 'lesson'`. A cancelled condition is reported from the lesson's current state (`throwForLessonState`).
6. Return the lesson read again.

Allowed in a draft or a published course, and on a hidden lesson: the mark is independent of visibility. It does not touch `course.updatedAt` or any instructor record, as other lesson edits do not.

## Refusals

| Case | Result |
|------|--------|
| Caller is not an instructor of the course | `FORBIDDEN` (from `courseInstructorProcedure`) |
| Lesson missing | `NOT_FOUND` |
| Lesson, its module or its course archived | `PRECONDITION_FAILED`, as other lesson edits |
| Marking an assignment lesson | `BAD_REQUEST` "Assignment lessons can't be free previews" |
| Unmarking an assignment lesson | Returns it unchanged (it has no mark) |
| The lesson was archived between the read and the write | Reported as archived; nothing written |

## Tests

`procedures/lesson.test.ts`, following the file's existing pattern:

- marking writes `freePreview: true`; unmarking removes the attribute and never writes `false`;
- marking twice, and unmarking an unmarked lesson, write nothing and return the lesson;
- an assignment lesson is refused with nothing written, and the write's condition includes `kind = 'lesson'`;
- an archived lesson, an archived module and an archived course are each refused;
- a lesson archived between the read and the write (the transaction's condition fails) is reported as archived, with nothing written, in the style of `curriculum-lifecycle-races.test.ts`;
- a non-instructor is refused;
- a draft course and a hidden lesson can be marked;
- `course.updatedAt` and `courseInstructor` are not written;
- create, update, publish, hide and restore return `freePreview` and leave the stored mark as it was.
