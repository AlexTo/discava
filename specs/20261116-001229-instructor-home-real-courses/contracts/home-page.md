# Contract: Instructor Home Page

The only interface is the page itself; it calls an existing API unchanged.

## Consumed API

`course.listByInstructor({ instructorId: <signed-in sub>, limit: 100 })` on core-api. See [`ListCoursesByInstructorInputSchema`](../../packages/apis/core-api/src/schema/course.ts). Returns `{ items: Course[], cursor? }`, newest updated first.

## Page states

| State | Condition | Shows |
|-------|-----------|-------|
| Loading | request pending, or no `sub` yet | Spinner. Never the empty state |
| Error | request failed | Error alert "Couldn't load your courses" with a Retry button. Never the empty state |
| Empty | request succeeded, no non-archived courses | Empty message and a "Create a course" action |
| Ready | one or more non-archived courses | Summary count, up to 6 course cards, "View all courses" link to `/my-courses` |

## Course card

Title, status badge, image or placeholder. The whole card links to `/my-courses/$courseId`. Text-only buttons, no arrow icons.

## Not shown (removed)

Grading queue, upcoming dates, recent activity, student and to-grade figures, and any quick action other than "Create a course".
