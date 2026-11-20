# Contract: portal UI

Buttons carry text only, with no arrow icons (repository convention).

## Student portal: the landing page outline

`routes/learn/$courseId/-components/course-page.tsx`, in the "modules" section.

| Lesson in `course.publicView` | Row |
|-------------------------------|-----|
| `freePreview: true` | The title is a link to `/learn/$courseId/preview/$lessonId`, followed by a "Free preview" badge |
| `freePreview: false` | As today: plain title, with the assignment marker where it applies |

The row looks the same to signed-out, signed-in and enrolled viewers. An enrolled student who follows the link is sent on to the lesson (below).

## Student portal: the preview page

Route `routes/learn/$courseId/preview/$lessonId.tsx`, public (no `requireSignIn`). Component `-components/free-preview-page.tsx`.

### Data

1. `course.publicView({ courseId })`: the course's title and price, and the outline, in which the lesson's `moduleId` and `freePreview` are found.
2. `freePreview.lesson({ courseId, moduleId, lessonId })`, only when the outline has the lesson with `freePreview: true`. `retry: false`.
3. `course.myEnrolment({ courseId })`, only when signed in.

### States

| Condition | Page |
|-----------|------|
| Loading | The portal's usual skeleton |
| Signed in with a current enrolment (`active` or `completed`) | Navigate to `/learn/$courseId/lesson/$lessonId`, replacing the history entry. Checked before the rows below, so a student of an archived course still reaches their lesson |
| `course.publicView` is `NOT_FOUND` | "This preview is no longer available." No link |
| The outline lacks the lesson, or has it with `freePreview: false`, or `freePreview.lesson` is `NOT_FOUND` | "This preview is no longer available." and a link "View the course" to `/learn/$courseId` |
| Any other error | The portal's `ErrorAlert` with a retry |
| Open preview | The layout below |

### Layout of an open preview

- The course title, linking to `/learn/$courseId`, and a "Free preview" badge.
- The lesson's title (`h1`) and description.
- The items in order (`-components/free-preview-item.tsx`):

  | Item | Shown as |
  |------|----------|
  | `video`, `playable` | A poster with a **Play** button. Pressing it requests `freePreview.videoUrl` and mounts `HlsVideo` with the address, `withCredentials` and captions, `autoPlay`. While mounted the query refetches every 30 minutes, in the background too; an unchanged address does not remount the player. A `NOT_FOUND` shows "This video is not available" |
  | `video`, not `playable` | "This video is being prepared." |
  | `text` | The body, rendered as the lesson page renders text items |
  | `file` | File name and size with a **Download** button, which requests `freePreview.fileUrl` at that moment and opens the link |
  | `quiz` | A card: title, "<n> questions", "Enrol to take this quiz". No button to start |

- No "Mark as done", no progress, no discussion, no step bar.
- With no items: "This lesson has nothing to show yet."
- A panel "Like what you see?" holding `EnrolmentActions` for the course (the landing page's own component, with the price) and the line "Your progress is saved once you enrol."
- "More free previews": links to the course's other lessons with `freePreview: true`, in outline order. Left out when there are none.

### After enrolling

`EnrolmentActions` gains an optional `continueTo` prop (`{ lessonId }`). When set, the enrolled dialog's button reads "Start this lesson" and links to `/learn/$courseId/lesson/$lessonId` instead of the course home. The landing page does not pass it. A purchase leaves for the payment page and returns to the landing page, as the checkout defines; nothing here changes that.

### Tests

`free-preview-item.test.tsx`, `free-preview-page.test.tsx` and the existing `course-page` and `enrolment-actions` tests, with `renderWithCoreApi`:

- each state row; each item row;
- no `freePreview.videoUrl` call before Play and no `freePreview.fileUrl` call before Download;
- the calls list never contains `contentItem.videoUrl`, `contentItem.fileUrl`, `contentItem.saveVideoPosition`, `contentItem.complete`, `quiz.view`, `course.view` or any `discussion.*` operation;
- the refetch interval (fake timers) and no remount on an unchanged address;
- signed out: no `course.myEnrolment` call; enrolled: navigation to the lesson route;
- an outline lesson with `freePreview: false` shows "no longer available" without calling `freePreview.lesson`;
- the outline labels and links only lessons with `freePreview: true`;
- `continueTo` changes the enrolled dialog's link; without it the link is unchanged;
- no arrow icon in any button.

## Instructor portal: the course editor

`routes/_authenticated/my-courses_/$courseId/-components/course/course-modules.tsx`, on each lesson row beside `LessonVisibilityButton`.

### Control: `lesson/free-preview-button.tsx`

| Lesson | Control |
|--------|---------|
| `kind` `assignment` | None |
| Archived | None, like the other edit controls |
| Ordinary, not marked | **Make free preview**. Opens a confirmation: "Anyone will be able to open this lesson without enrolling or paying: its videos, text and files. Quizzes stay locked." with **Make free preview** and **Cancel** |
| Ordinary, marked | **Remove free preview**. No confirmation; it takes effect at once |

Both call `lesson.setFreePreview`, show the API's message on failure (`apiErrorMessage`) and refresh the course as the visibility buttons do.

### Badge: `lesson/free-preview-badge.tsx`

| Marked lesson | Badge |
|---------------|-------|
| Visible, in a visible module of a published course | "Free preview" |
| Otherwise (hidden lesson or module, draft course) | "Free preview (not public yet)" |

### Tests

`free-preview-button.test.tsx` with `renderWithInstructorApi`: the control per row of the table; marking sends `{ freePreview: true }` only after confirming and Cancel sends nothing; removing sends `{ freePreview: false }` at once; an `ApiError` shows its message; the badge's two texts; no arrow icons.
