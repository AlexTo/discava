# Contract: instructor portal screens

All under `packages/websites/instructor-portal/src/routes/_authenticated/`.

## Questions editor (`my-courses_/$courseId/-components/content-items/video-questions/`)

Opened by a **Questions** button on a video's row in `lesson-content-items-row.tsx`, beside **Captions**. The button's label carries the count when there are any ("Questions (3)"). It is disabled, with the reason, while the video has no playable version.

A large dialog, like the quiz builder's (`quiz/quiz-builder-dialog.tsx`):

| Area | Content |
|---|---|
| Player | The video (`HlsVideo` from `contentItem.createVideoUrl`), with a marker per question. Under it: the current time and **Add a question here**, and **Add an end question** |
| Question list | One card per question in asking order: timed ones by time, then "End of video". Each card is the quiz builder's `QuestionCard` (prompt, single or multiple, options with correct markers, explanation) with one more field, **Ask at**: a time input (`m:ss`, or `h:mm:ss` for long videos) and an **At the end** switch |
| Save bar | **Save** and the unsaved-changes state, like `quiz-save-bar.tsx` |
| Preview | **Preview as student** plays the video with the questions as they stand in the editor, saved or not, through the shared question card. Answers are graded in the browser and nothing is sent |

Rules:

- A new timed question takes the player's current time, rounded down to a whole second. Changing **Ask at** re-sorts the list and moves the marker. Choosing a marker scrolls to its card.
- Questions at the same moment, and end questions, can be moved up and down among themselves with **Move up** and **Move down** buttons. Order across different moments is always by time.
- A question timed at or past the video's duration is marked "After the end of the video: asked with the end check".
- Validation is `validateQuiz`'s per-question rules from `quiz/quiz-form.ts` plus: a valid time, and at most 20 questions (the add buttons are disabled at 20, with the reason). A card with a problem is marked, and **Save** names the first one.
- **Save** calls `contentItem.updateVideoQuestions` with the loaded `quizVersion` (0 when the video had none) and uses the returned version for the next save. `CONFLICT` offers to reload the latest questions, as the quiz builder does. Other errors show in an `ErrorAlert`.
- Closing with unsaved changes asks first.
- Read-only, with the reason, while the video or anything above it is archived.
- When the video's `studentActivityCount` is above 0, a notice at the top says: "N learners have used this video. Answers already recorded are kept and aren't regraded."
- Removing the last question and saving returns the video to having none.

State lives in a `use-video-questions-editor.ts` hook beside the dialog, and the mapping to and from the API shapes in `video-questions-form.ts`, mirroring `use-quiz-builder-state.ts` and `quiz-form.ts`.

## Video preview

The existing preview in `attach-lesson-video-dialog.tsx` shows the questions the same way as **Preview as student** above, from the item's saved `questions` and `answerKey`.

## Quiz builder (`quiz/quiz-settings-section.tsx`)

Under "Show the correct answers", a hint: "Learners remember more when they see the answers straight after each attempt." A new quiz starts on **After each attempt** (it already does; a test pins it).

## Course analytics (`dashboard_/$courseId/`)

- **Video questions** card, beside the quizzes list: each video from `analytics.course`'s `videoQuestions` with its question count. Choosing one loads `analytics.videoQuestions` and lists the questions as the quiz results do: the moment ("1:30" or "End of video"), the start of the prompt, answers, misses and miss rate, ranked ones first, and "Not enough answers yet" for one with fewer than 5. With no such videos the card says "No videos with questions are shown to learners yet."
- **Lesson drop-off** card (`-components/lesson-drop-off.tsx`): when `modulesWithoutQuestions` isn't empty, a note above the list: "These modules have video and no questions: …. Learners remember more when a video asks them something." Module titles are plain text. No note when the list is empty.

## Component tests

Beside each component, with `renderWithInstructorApi`: the editor (add at the current time, edit the time, mark as an end question, reorder within a moment, validation, the 20 limit, save input and version handling, `CONFLICT` reload, read-only when archived, the learners notice, the unsaved-changes prompt), the preview (a question appears and is graded with no API call), the row's button and count, the quiz builder's default and hint, the analytics card and the drop-off note.
