# Contract: student portal UI

All buttons are text only (no arrow icons).

## Course page (`enrolment-actions.tsx`): the moment of enrolling

This replaces one row of the checkout spec's `contracts/student-portal-ui.md` and changes nothing else in it.

| Event | Before | Now |
|-------|--------|-----|
| `course.enrol` succeeds (**Enrol now**) | "You're enrolled!" dialog with **Keep browsing** and **Start learning** | Navigate to `/learn/<courseId>/start`. No dialog |
| `?checkout=success` and the enrolment appears while "Confirming your payment" is shown | The same dialog | Navigate to `/learn/<courseId>/start`, replacing the history entry |
| `?checkout=success` and the learner is already enrolled when the page first reads the enrolment | The enrolled card | Navigate to `/learn/<courseId>/start`, replacing the history entry |
| `?checkout=success`, not enrolled: waiting, then the 60 s message | unchanged | unchanged |
| An enrolled learner opens the course page without `?checkout=success` | The enrolled card with **Start learning**, **Continue learning** or **Review course**, linking to the course home | unchanged |

The "You're enrolled!" dialog and its two buttons are removed from the component.

## Start route (`/learn/$courseId/start`)

Signed-in only (`requireSignIn`), like the lesson route.

| State | Shown |
|-------|-------|
| The course, the learner's completions or lesson progress still loading | "Opening your course…" with `role="status"` |
| Loaded, a next lesson exists | Replaced by `/learn/<courseId>/lesson/<lessonId>` with history state `{ enrolled: true }` |
| Loaded, no lesson shown | Replaced by `/learn/<courseId>/home` with the same state |
| The course cannot be read (not enrolled, not found) | The same message the course home shows for that error |

"Next lesson" is `useCoursePlayer`'s `nextLesson`: the first shown lesson not yet complete. Opening the start route by hand, enrolled, is the same as pressing **Continue**.

## Confirmation line (`enrolled-notice.tsx`)

On the lesson page and the course home, above the page's content, only when the history state has `enrolled: true`:

> You're enrolled in <course title>.

`role="status"`, no button, no focus change. It is not shown when the page is opened any other way.

## Lesson page

Unchanged apart from the line above and the prompt below: the first item is at the top with its player, and nothing plays by itself.

## The prompt (`discussion/first-lesson-prompt.tsx`, inside the Questions section)

Shown when all of these hold: the lesson is the first of `useCoursePlayer`'s `lessons`; the course is not read-only; the learner's enrolment (`course.myEnrolment`) is `active` or `completed` and has no `firstLessonPromptState`; the questions list has loaded without error; no thread is open. It sits under the "Questions" heading, above the list.

| Element | Detail |
|---------|--------|
| Text | `course.view`'s `firstLessonPrompt`, as the form's legend |
| Field | One textarea labelled "Your answer", at most 4,000 characters, with the count |
| Note | "Everyone in this course can read your answer." |
| **Post** | Disabled while the field is blank or the request is running. Calls `discussion.answerPrompt` with a post id from `usePostId` |
| **Not now** | Calls `course.dismissFirstLessonPrompt` |

| Outcome | Result |
|---------|--------|
| Post succeeds | The enrolment in the cache gets `answered`, the questions list is refetched (the answer is at the top), the prompt is gone |
| Not now succeeds | The enrolment in the cache gets `dismissed`, the prompt is gone |
| `PRECONDITION_FAILED` (already closed elsewhere) | The enrolment is refetched and the prompt goes away without an error |
| Any other failure | An error alert with the API's message; what was typed is kept |

The prompt never takes focus when the page opens.

**In lists**: a post with `promptAnswer` shows the label "Answer to the course prompt" in `PostCard` (student and instructor portals), and no "Answered" state.

## Tests

Component tests with `renderWithCoreApi`: every row of the tables above. In particular: enrolling navigates and renders no dialog; the confirming state navigates only once the enrolment appears; `?checkout=success` without an enrolment never navigates; the start route goes to the first lesson for a new learner, to the third for one who completed two, and to the course home with no lessons; the prompt is absent on the second lesson, for a learner with either state, in a read-only course, with a thread open and with no enrolment; no arrow icon in any button.

End to end, with `screenshot()`: the landing after a free enrolment and after a purchase, the prompt, the posted answer, and a second browser session of the same learner showing no prompt.
